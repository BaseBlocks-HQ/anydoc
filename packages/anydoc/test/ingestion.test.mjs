import assert from "node:assert/strict";
import test from "node:test";

import { DocumentPlatformError } from "@baseblocks/anydoc-contracts";
import { createIngestionRuntime, createLeasePolicy, createRetryPolicy } from "../src/ingestion.js";
import { createMemoryContentSink, createMemoryIndexSink, createMemoryJobStore } from "../src/memory.js";
import { bytesSource } from "../src/sources.js";

const encoder = new TextEncoder();

function runtimeOptions(overrides = {}) {
  let identifier = 0;
  return {
    jobs: createMemoryJobStore({ makeToken: () => `lease-${++identifier}` }),
    contentSink: createMemoryContentSink(),
    indexSink: createMemoryIndexSink(),
    resolveSource: () => bytesSource(encoder.encode("hello"), { filename: "test.txt" }),
    process: ({ bytes, format }) => ({ content: { blocks: [{ type: "paragraph", text: new TextDecoder().decode(bytes) }] }, format, text: "hello" }),
    makeId: () => `id-${++identifier}`,
    lease: createLeasePolicy({ durationMs: 10_000, heartbeatMs: 1_000 }),
    retry: createRetryPolicy({ maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 100, jitter: 0 }),
    ...overrides,
  };
}

test("runtime executes durable phases and deduplicates enqueue and sinks", async () => {
  const options = runtimeOptions();
  const runtime = createIngestionRuntime(options);
  const first = await runtime.enqueue({ idempotencyKey: "tenant:document:v1", source: { key: "file" }, format: ".TXT" });
  const duplicate = await runtime.enqueue({ idempotencyKey: "tenant:document:v1", source: { key: "other" }, format: "txt" });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.id, first.job.id);

  const result = await runtime.run(first.job.id, { workerId: "worker-1" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.job.state, "succeeded");
  assert.equal(result.job.output.byteLength, 5);
  assert.equal(options.contentSink.size(), 1);
  assert.equal(options.indexSink.size(), 1);
  assert.equal((await runtime.run(first.job.id)).status, "not-runnable");
});

test("retryable sink interruption resumes without duplicating content", async () => {
  let now = 1_000;
  let indexAttempts = 0;
  const contentSink = createMemoryContentSink();
  const options = runtimeOptions({
    clock: () => now,
    contentSink,
    indexSink: {
      async write() {
        indexAttempts += 1;
        if (indexAttempts === 1) throw new DocumentPlatformError("temporary", { code: "sink-failed", retryable: true });
        return { ref: "index:ready" };
      },
    },
  });
  const runtime = createIngestionRuntime(options);
  const { job } = await runtime.enqueue({ idempotencyKey: "retry", source: {}, format: "docx" });
  const interrupted = await runtime.run(job.id);
  assert.equal(interrupted.status, "retry-scheduled");
  assert.equal(contentSink.size(), 1);

  now = interrupted.job.nextAttemptAt;
  const recovered = await runtime.run(job.id);
  assert.equal(recovered.status, "succeeded");
  assert.equal(contentSink.size(), 1);
  assert.equal(indexAttempts, 2);
});

test("expired leases are recoverable and stale workers cannot checkpoint", async () => {
  const jobs = createMemoryJobStore({ makeToken: (() => { let id = 0; return () => `token-${++id}`; })() });
  const options = runtimeOptions({ jobs });
  const runtime = createIngestionRuntime(options);
  const { job } = await runtime.enqueue({ idempotencyKey: "lease", source: {}, format: "pdf" });
  const first = await jobs.claim(job.id, { workerId: "old", durationMs: 10, now: 0 });
  const second = await jobs.claim(job.id, { workerId: "new", durationMs: 10, now: 11 });
  assert.equal(second.attempt, 2);
  assert.equal(await jobs.update(job.id, { leaseToken: first.lease.token, now: 11, patch: { phase: "process" } }), null);
  assert.equal((await jobs.update(job.id, { leaseToken: second.lease.token, now: 11, patch: { phase: "process" } })).phase, "process");
  await assert.rejects(
    jobs.update(job.id, { leaseToken: second.lease.token, now: 11, patch: { input: { source: "swapped" } } }),
    { code: "job-conflict" },
  );
});

test("an expired final lease becomes terminal instead of stranding a running job", async () => {
  const jobs = createMemoryJobStore({ makeToken: () => "only-token" });
  const job = {
    id: "job", idempotencyKey: "final-lease", state: "queued", phase: "queued", revision: 0,
    attempt: 0, maxAttempts: 1, createdAt: 0, updatedAt: 0, input: { source: {}, format: "pdf" },
  };
  await jobs.create(job);
  await jobs.claim(job.id, { workerId: "worker", durationMs: 10, now: 0 });
  assert.equal(await jobs.claim(job.id, { workerId: "replacement", durationMs: 10, now: 11 }), null);
  const terminal = await jobs.get(job.id);
  assert.equal(terminal.state, "failed");
  assert.equal(terminal.error.code, "lease-lost");
});

test("native render models and source bytes cannot cross the ingestion boundary", async () => {
  const runtime = createIngestionRuntime(runtimeOptions({
    process: () => ({ content: {}, nativeRender: {} }),
    retry: createRetryPolicy({ maxAttempts: 1 }),
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "separation", source: {}, format: "pptx" });
  const result = await runtime.run(job.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "processing-failed");
});

test("terminal failure honors max attempts and observer failures are isolated", async () => {
  let now = 0;
  const events = [];
  const runtime = createIngestionRuntime(runtimeOptions({
    clock: () => now,
    observer(event) {
      events.push(event.type);
      throw new Error("telemetry unavailable");
    },
    resolveSource() {
      throw new DocumentPlatformError("busy", { code: "fetch-failed", retryable: true });
    },
    retry: createRetryPolicy({ maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitter: 0 }),
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "attempt-limit", source: {}, format: "pdf" });
  const first = await runtime.run(job.id);
  assert.equal(first.status, "retry-scheduled");
  now = first.job.nextAttemptAt;
  const second = await runtime.run(job.id);
  assert.equal(second.status, "failed");
  assert.equal(second.job.attempt, 2);
  assert.ok(events.includes("job.enqueued"));
  assert.ok(events.includes("job.failed"));
});

test("non-durable sink results fail at the persistence boundary", async () => {
  const runtime = createIngestionRuntime(runtimeOptions({
    contentSink: { async write() { return { callback() {} }; } },
    retry: createRetryPolicy({ maxAttempts: 1 }),
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "durability", source: {}, format: "docx" });
  const result = await runtime.run(job.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "sink-failed");
});
