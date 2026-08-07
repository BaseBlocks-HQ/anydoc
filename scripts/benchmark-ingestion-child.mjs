import { performance } from "node:perf_hooks";

import { iterableSource, readSource } from "../packages/ingestion/src/sources.js";

const mebibyte = 1024 * 1024;
const byteLength = Number(process.env.ANYDOC_BENCH_BYTES ?? 24 * mebibyte);
const chunkBytes = 64 * 1024;

function unknownLengthSource(size) {
  const chunk = Uint8Array.from({ length: chunkBytes }, (_, index) => index & 0xff);
  return iterableSource(async function* () {
    for (let offset = 0; offset < size; offset += chunkBytes) {
      const length = Math.min(chunkBytes, size - offset);
      yield chunk.subarray(0, length);
    }
  });
}

for (let warmup = 0; warmup < 2; warmup += 1) {
  await readSource(unknownLengthSource(2 * mebibyte), { maxBytes: 2 * mebibyte, calculateSha256: true });
}
globalThis.gc?.();
const baselineMaxRss = process.resourceUsage().maxRSS * 1024;
const baselineArrayBuffers = process.memoryUsage().arrayBuffers;
let peakArrayBuffers = baselineArrayBuffers;
const started = performance.now();
const result = await readSource(unknownLengthSource(byteLength), {
  maxBytes: byteLength,
  calculateSha256: true,
  onProgress() {
    peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);
  },
});
const elapsedMs = performance.now() - started;
peakArrayBuffers = Math.max(peakArrayBuffers, process.memoryUsage().arrayBuffers);

process.stdout.write(JSON.stringify({
  byteLength: result.byteLength,
  elapsedMs,
  throughputMibPerSecond: (byteLength / mebibyte) / (elapsedMs / 1_000),
  arrayBufferDelta: Math.max(0, peakArrayBuffers - baselineArrayBuffers),
  peakRssDelta: Math.max(0, process.resourceUsage().maxRSS * 1024 - baselineMaxRss),
  sha256: result.sha256,
}));
