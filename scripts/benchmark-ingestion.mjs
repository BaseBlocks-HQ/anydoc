import { spawnSync } from "node:child_process";

const mebibyte = 1024 * 1024;
const inputBytes = 24 * mebibyte;
const minimumThroughput = 12;
const maximumArrayBuffers = inputBytes * 2.25 + 2 * mebibyte;
const maximumRssGrowth = inputBytes * 3 + 32 * mebibyte;
const repetitions = 5;
const timeoutMs = 30_000;

const samples = [];
for (let repetition = 0; repetition < repetitions; repetition += 1) {
  const run = spawnSync(process.execPath, ["--expose-gc", "scripts/benchmark-ingestion-child.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...process.env, ANYDOC_BENCH_BYTES: String(inputBytes) },
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (run.error?.code === "ETIMEDOUT") {
    console.error(`Ingestion benchmark subprocess ${repetition + 1} exceeded ${timeoutMs}ms.`);
    process.exit(1);
  }
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout || `Ingestion benchmark subprocess ${repetition + 1} failed without output.\n`);
    process.exit(run.status ?? 1);
  }
  samples.push(JSON.parse(run.stdout));
}

const orderedThroughput = samples.map((sample) => sample.throughputMibPerSecond).sort((a, b) => a - b);
const medianThroughput = orderedThroughput[Math.floor(orderedThroughput.length / 2)];
const maximumArrayBufferGrowth = Math.max(...samples.map((sample) => sample.arrayBufferDelta));
const maximumPeakRssGrowth = Math.max(...samples.map((sample) => sample.peakRssDelta));
const validMaterialization = samples.every((sample) => sample.byteLength === inputBytes);
const validDigests = new Set(samples.map((sample) => sample.sha256)).size === 1 && samples[0].sha256?.length === 64;
const checks = [
  ["materialized bytes", validMaterialization, `${samples.length} / ${repetitions} exact runs`],
  ["streaming SHA-256", validDigests, samples[0].sha256],
  ["median throughput", medianThroughput >= minimumThroughput, `${medianThroughput.toFixed(1)} / ${minimumThroughput} MiB/s minimum (${orderedThroughput.map((value) => value.toFixed(1)).join(", ")})`],
  ["maximum ArrayBuffer growth", maximumArrayBufferGrowth <= maximumArrayBuffers, `${(maximumArrayBufferGrowth / mebibyte).toFixed(1)} / ${(maximumArrayBuffers / mebibyte).toFixed(1)} MiB maximum`],
  ["maximum peak resident-memory growth", maximumPeakRssGrowth <= maximumRssGrowth, `${(maximumPeakRssGrowth / mebibyte).toFixed(1)} / ${(maximumRssGrowth / mebibyte).toFixed(1)} MiB maximum`],
];
let failed = false;
for (const [name, passed, detail] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}: ${detail}`);
  failed ||= !passed;
}
if (failed) process.exitCode = 1;
