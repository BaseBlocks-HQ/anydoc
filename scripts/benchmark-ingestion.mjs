import { spawnSync } from "node:child_process";

const mebibyte = 1024 * 1024;
const inputBytes = 24 * mebibyte;
const minimumThroughput = 12;
const maximumArrayBuffers = inputBytes * 2.25 + 2 * mebibyte;
const maximumRssGrowth = inputBytes * 3 + 32 * mebibyte;

const run = spawnSync(process.execPath, ["--expose-gc", "scripts/benchmark-ingestion-child.mjs"], {
  cwd: new URL("..", import.meta.url),
  encoding: "utf8",
  env: { ...process.env, ANYDOC_BENCH_BYTES: String(inputBytes) },
});
if (run.status !== 0) {
  process.stderr.write(run.stderr);
  process.exit(run.status ?? 1);
}
const metrics = JSON.parse(run.stdout);
const checks = [
  ["materialized bytes", metrics.byteLength === inputBytes, `${metrics.byteLength} / ${inputBytes}`],
  ["streaming SHA-256", typeof metrics.sha256 === "string" && metrics.sha256.length === 64, metrics.sha256],
  ["throughput", metrics.throughputMibPerSecond >= minimumThroughput, `${metrics.throughputMibPerSecond.toFixed(1)} / ${minimumThroughput} MiB/s minimum`],
  ["ArrayBuffer growth", metrics.arrayBufferDelta <= maximumArrayBuffers, `${(metrics.arrayBufferDelta / mebibyte).toFixed(1)} / ${(maximumArrayBuffers / mebibyte).toFixed(1)} MiB maximum`],
  ["peak resident-memory growth", metrics.peakRssDelta <= maximumRssGrowth, `${(metrics.peakRssDelta / mebibyte).toFixed(1)} / ${(maximumRssGrowth / mebibyte).toFixed(1)} MiB maximum`],
];
let failed = false;
for (const [name, passed, detail] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}: ${detail}`);
  failed ||= !passed;
}
if (failed) process.exitCode = 1;
