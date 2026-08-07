import assert from "node:assert/strict";
import test from "node:test";

import { DocumentPlatformError } from "@baseblocks/anydoc-contracts";
import { createIngestionRuntime, createLeasePolicy, createRetryPolicy, executeIngestion } from "../src/ingestion.js";
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

test("one-shot execution composes bounded source, processor, and sinks without a job store", async () => {
  const phases = [];
  const sinkInputs = [];
  const result = await executeIngestion({
    source: { key: "direct" },
    format: ".TXT",
    expectedSize: 5,
    idempotencyKey: "tenant:direct:v1",
    resolveSource: () => bytesSource(encoder.encode("hello")),
    process: ({ bytes, format }) => ({ content: { text: new TextDecoder().decode(bytes) }, text: "hello", format }),
    contentSink: { async write(input) { sinkInputs.push(input); return { ref: "content:direct" }; } },
    indexSink: { async write(input) { sinkInputs.push(input); return { ref: "index:direct" }; } },
    onPhase: (phase) => phases.push(phase),
  });
  assert.deepEqual(phases, ["acquire-source", "read-source", "process", "store-content", "store-index"]);
  assert.equal(result.source.byteLength, 5);
  assert.equal(result.output.byteLength, 5);
  assert.deepEqual(result.output.content, { ref: "content:direct" });
  assert.deepEqual(result.output.index, { ref: "index:direct" });
  assert.equal(sinkInputs[0].idempotencyKey, "tenant:direct:v1:content");
  assert.equal(sinkInputs[1].idempotencyKey, "tenant:direct:v1:index");
  assert.ok(!("job" in sinkInputs[0]));
});

test("one-shot execution honors an already-aborted signal before source or sink work", async () => {
  const controller = new AbortController();
  controller.abort(new DocumentPlatformError("stopped", { code: "aborted" }));
  let calls = 0;
  await assert.rejects(executeIngestion({
    source: {},
    format: "pdf",
    idempotencyKey: "cancelled-direct",
    signal: controller.signal,
    resolveSource() { calls += 1; return bytesSource(new Uint8Array()); },
    process: () => ({ content: {} }),
    contentSink: { async write() { calls += 1; return {}; } },
  }), { code: "aborted" });
  assert.equal(calls, 0);
});

test("one-shot execution preserves the abort reason across asynchronous host phases", async () => {
  for (const phase of ["resolve", "process", "content", "index"]) {
    const controller = new AbortController();
    const reason = new DocumentPlatformError(`cancelled during ${phase}`, { code: "aborted", retryable: true });
    let notifyStarted;
    const started = new Promise((resolve) => { notifyStarted = resolve; });
    const interrupted = async (signal) => {
      notifyStarted();
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("host callback masked cancellation")), { once: true }));
    };
    const execution = executeIngestion({
      source: {},
      format: "txt",
      idempotencyKey: `abort-${phase}`,
      signal: controller.signal,
      resolveSource: phase === "resolve" ? (_, { signal }) => interrupted(signal) : () => bytesSource(encoder.encode("hello")),
      process: phase === "process" ? ({ signal }) => interrupted(signal) : () => ({ content: { text: "hello" } }),
      contentSink: {
        write: phase === "content" ? ({ signal }) => interrupted(signal) : async () => ({ ref: "content" }),
      },
      ...(phase === "index" ? { indexSink: { write: ({ signal }) => interrupted(signal) } } : {}),
    });
    await started;
    controller.abort(reason);
    await assert.rejects(execution, (cause) => cause === reason);
  }
});

test("one-shot execution forwards its absolute deadline to bounded source reads", async () => {
  let processed = false;
  await assert.rejects(executeIngestion({
    source: {},
    format: "txt",
    deadline: Date.now() - 1,
    idempotencyKey: "expired-deadline",
    resolveSource: () => bytesSource(encoder.encode("hello")),
    process: () => { processed = true; return { content: {} }; },
    contentSink: { async write() { return {}; } },
  }), { code: "deadline-exceeded", retryable: true });
  assert.equal(processed, false);
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

test("native render models and source bytes cannot cross any nested ingestion boundary", async () => {
  for (const [index, content] of [
    { viewerModel: {} },
    { nested: { nativeRender: {} } },
    { pages: [{ metadata: { sourceBytes: "not-source-data" } }] },
  ].entries()) {
    let writes = 0;
    const runtime = createIngestionRuntime(runtimeOptions({
      process: () => ({ content }),
      contentSink: { async write() { writes += 1; return {}; } },
      retry: createRetryPolicy({ maxAttempts: 1 }),
    }));
    const { job } = await runtime.enqueue({ idempotencyKey: `separation-${index}`, source: {}, format: "pptx" });
    const result = await runtime.run(job.id);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "processing-failed");
    assert.equal(writes, 0);
  }
});

test("checkpoint storage failures remain retryable infrastructure failures", async () => {
  const stored = createMemoryJobStore();
  let failed = false;
  const jobs = {
    create: (...args) => stored.create(...args),
    get: (...args) => stored.get(...args),
    claim: (...args) => stored.claim(...args),
    renew: (...args) => stored.renew(...args),
    cancel: (...args) => stored.cancel(...args),
    async update(...args) {
      if (!failed) {
        failed = true;
        throw new Error("transient database outage");
      }
      return stored.update(...args);
    },
  };
  const runtime = createIngestionRuntime(runtimeOptions({ jobs }));
  const { job } = await runtime.enqueue({ idempotencyKey: "checkpoint-outage", source: {}, format: "pdf" });
  const result = await runtime.run(job.id);
  assert.equal(result.status, "retry-scheduled");
  assert.equal(result.error.code, "lease-lost");
  assert.equal(result.error.retryable, true);
  assert.equal(result.job.error.code, "lease-lost");
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

test("non-durable artifacts fail before any sink side effect", async () => {
  let writes = 0;
  const runtime = createIngestionRuntime(runtimeOptions({
    process: () => ({ content: { callback() {} } }),
    contentSink: { async write() { writes += 1; return { ref: "unexpected" }; } },
    retry: createRetryPolicy({ maxAttempts: 1 }),
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "artifact-durability", source: {}, format: "docx" });
  const result = await runtime.run(job.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "processing-failed");
  assert.equal(writes, 0);
});

test("portable artifacts encode binary before either sink observes them", async () => {
  const observed = [];
  const runtime = createIngestionRuntime(runtimeOptions({
    process: () => ({ content: { asset: Uint8Array.of(1, 2, 3) }, metadata: { trusted: false } }),
    contentSink: { async write(input) { observed.push(input.artifact); return { ref: "content" }; } },
    indexSink: { async write(input) { observed.push(input.artifact); return { ref: "index" }; } },
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "portable-binary", source: {}, format: "docx" });
  const result = await runtime.run(job.id);
  assert.equal(result.status, "succeeded");
  const expected = { content: { asset: { $anydoc: "binary/base64", data: "AQID" } }, metadata: { trusted: false } };
  assert.deepEqual(observed, [expected, expected]);
});

test("non-portable artifact types are rejected before sink side effects", async () => {
  const cycle = {};
  cycle.self = cycle;
  const invalidValues = [new Date(), new Map(), new Set(), 1n, Number.NaN, cycle];
  for (const [index, invalid] of invalidValues.entries()) {
    let writes = 0;
    const runtime = createIngestionRuntime(runtimeOptions({
      process: () => ({ content: { invalid } }),
      contentSink: { async write() { writes += 1; return {}; } },
      retry: createRetryPolicy({ maxAttempts: 1 }),
    }));
    const { job } = await runtime.enqueue({ idempotencyKey: `invalid-artifact-${index}`, source: {}, format: "docx" });
    const result = await runtime.run(job.id);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "processing-failed");
    assert.equal(writes, 0);
  }
});

test("non-portable job descriptors and sink results fail at their persistence boundaries", async () => {
  const runtime = createIngestionRuntime(runtimeOptions());
  await assert.rejects(
    runtime.enqueue({ idempotencyKey: "invalid-descriptor", source: { createdAt: new Date() }, format: "docx" }),
    (cause) => cause?.code === "invalid-source",
  );

  const invalidSinkRuntime = createIngestionRuntime(runtimeOptions({
    contentSink: { async write() { return { createdAt: new Date() }; } },
    retry: createRetryPolicy({ maxAttempts: 1 }),
  }));
  const { job } = await invalidSinkRuntime.enqueue({ idempotencyKey: "invalid-sink-result", source: {}, format: "docx" });
  const result = await invalidSinkRuntime.run(job.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "sink-failed");
});

test("a stale worker emits lease loss instead of a false retry event", async () => {
  let now = 0;
  const events = [];
  const jobs = createMemoryJobStore({ makeToken: (() => { let id = 0; return () => `token-${++id}`; })() });
  const runtime = createIngestionRuntime(runtimeOptions({
    jobs,
    clock: () => now,
    observer: (event) => events.push(event.type),
    process: async ({ bytes, format }) => {
      now = 10_001;
      await jobs.claim("id-1", { workerId: "replacement", durationMs: 10_000, now });
      throw new DocumentPlatformError("old worker failed", { code: "processing-failed", retryable: true });
    },
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "stale-observer", source: {}, format: "pdf" });
  const result = await runtime.run(job.id, { workerId: "old" });
  assert.equal(result.status, "lease-lost");
  assert.ok(events.includes("job.lease-lost"));
  assert.ok(!events.includes("job.retry-scheduled"));
});

test("durable cancellation aborts active work and fences its worker", async () => {
  let started;
  const processing = new Promise((resolve) => { started = resolve; });
  let sinkWrites = 0;
  const runtime = createIngestionRuntime(runtimeOptions({
    process: async ({ signal }) => {
      started();
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
    contentSink: { async write() { sinkWrites += 1; } },
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "cancel-active", source: {}, format: "docx" });
  const running = runtime.run(job.id, { workerId: "active-worker" });
  await processing;
  const cancellation = await runtime.cancel(job.id, { reason: "authorization revoked" });
  const result = await running;
  assert.equal(cancellation.status, "cancelled");
  assert.equal(result.status, "cancelled");
  assert.equal(result.job.cancellation.reason, "authorization revoked");
  assert.equal(sinkWrites, 0);
  assert.equal((await runtime.run(job.id)).status, "not-runnable");
});

test("queued cancellation is idempotent and terminal jobs cannot be cancelled", async () => {
  const runtime = createIngestionRuntime(runtimeOptions());
  const { job } = await runtime.enqueue({ idempotencyKey: "cancel-queued", source: {}, format: "docx" });
  const first = await runtime.cancel(job.id);
  const repeated = await runtime.cancel(job.id);
  assert.equal(first.status, "cancelled");
  assert.equal(repeated.status, "cancelled");
  assert.equal(repeated.job.revision, first.job.revision);

  const completed = await runtime.enqueue({ idempotencyKey: "complete-first", source: {}, format: "docx" });
  await runtime.run(completed.job.id);
  assert.equal((await runtime.cancel(completed.job.id)).status, "not-cancellable");
  assert.equal((await runtime.cancel("missing")).status, "not-found");
});

test("artifact text and binary budgets fail before sink side effects", async () => {
  for (const [idempotencyKey, artifact, artifactLimits] of [
    ["large-text", { content: {}, text: "é".repeat(6) }, { maxArtifactBytes: 100, maxTextBytes: 10, maxBinaryBytes: 100 }],
    ["large-binary", { content: {}, assets: [new Uint8Array(11)] }, { maxArtifactBytes: 100, maxTextBytes: 100, maxBinaryBytes: 10 }],
    ["sparse-graph", { content: new Array(11) }, { maxArtifactBytes: 100, maxTextBytes: 100, maxBinaryBytes: 100, maxEntries: 10 }],
  ]) {
    let writes = 0;
    const runtime = createIngestionRuntime(runtimeOptions({
      artifactLimits,
      process: () => artifact,
      contentSink: { async write() { writes += 1; return {}; } },
      retry: createRetryPolicy({ maxAttempts: 1 }),
    }));
    const { job } = await runtime.enqueue({ idempotencyKey, source: {}, format: "docx" });
    const result = await runtime.run(job.id);
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "output-too-large");
    assert.equal(result.error.retryable, false);
    assert.equal(writes, 0);
  }
});

test("sink result budgets prevent oversized durable job output", async () => {
  const runtime = createIngestionRuntime(runtimeOptions({
    artifactLimits: { maxSinkResultBytes: 16 },
    contentSink: { async write() { return { reference: "x".repeat(32) }; } },
    retry: createRetryPolicy({ maxAttempts: 1 }),
  }));
  const { job } = await runtime.enqueue({ idempotencyKey: "large-result", source: {}, format: "docx" });
  const result = await runtime.run(job.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "output-too-large");
});
