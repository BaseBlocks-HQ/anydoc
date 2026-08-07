import { DocumentPlatformError, defaultDocumentLimits } from "@baseblocks/anydoc-contracts";
import { readSource } from "./sources.js";

export const ingestionRuntimeCapabilities = Object.freeze({
  durableJobs: true,
  idempotentSinks: true,
  leaseRecovery: true,
  nativeRenderModels: false,
  verifiedStreamingReads: true,
});

function error(message, code, cause, retryable = false) {
  return new DocumentPlatformError(message, { code, cause, retryable });
}

function asError(cause, fallbackCode, fallbackMessage, retryable = false) {
  if (cause instanceof DocumentPlatformError) return cause;
  return error(fallbackMessage, fallbackCode, cause, retryable);
}

function serializeError(value) {
  return value.toJSON();
}

function assertPort(value, method, name) {
  if (!value || typeof value[method] !== "function") {
    throw error(`${name} must implement ${method}().`, "invalid-source");
  }
}

function assertDurable(value, name, code = "sink-failed") {
  try {
    structuredClone(value);
  } catch (cause) {
    throw error(`${name} must be durable structured-clone data.`, code, cause);
  }
}

function throwIfAborted(signal) {
  if (signal.aborted) throw signal.reason ?? error("The ingestion run was aborted.", "aborted", undefined, true);
}

function emit(observer, event) {
  try {
    if (typeof observer === "function") observer(Object.freeze(event));
    else observer?.emit?.(Object.freeze(event));
  } catch {
    // Telemetry must never change ingestion semantics.
  }
}

export function createRetryPolicy(options = {}) {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const jitter = options.jitter ?? 0.2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw error("maxAttempts must be a positive integer.", "invalid-source");
  if (![baseDelayMs, maxDelayMs].every((value) => Number.isFinite(value) && value >= 0) || maxDelayMs < baseDelayMs) {
    throw error("Retry delays must be finite, non-negative, and ordered.", "invalid-source");
  }
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw error("Retry jitter must be between zero and one.", "invalid-source");
  return Object.freeze({
    maxAttempts,
    nextDelay(cause, attempt, random = Math.random) {
      const retryable = options.isRetryable?.(cause) ?? cause?.retryable === true;
      if (!retryable || attempt >= maxAttempts) return null;
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
      const multiplier = 1 - jitter + random() * jitter * 2;
      return Math.max(0, Math.round(exponential * multiplier));
    },
  });
}

export function createLeasePolicy(options = {}) {
  const durationMs = options.durationMs ?? 30_000;
  const heartbeatMs = options.heartbeatMs ?? Math.floor(durationMs / 3);
  if (!Number.isFinite(durationMs) || durationMs < 1_000) throw error("Lease duration must be at least one second.", "invalid-source");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 100 || heartbeatMs >= durationMs) {
    throw error("Lease heartbeat must be at least 100ms and shorter than the lease.", "invalid-source");
  }
  return Object.freeze({ durationMs, heartbeatMs });
}

export function createIngestionRuntime(options) {
  assertPort(options?.jobs, "create", "jobs");
  assertPort(options.jobs, "claim", "jobs");
  assertPort(options.jobs, "update", "jobs");
  assertPort(options.jobs, "renew", "jobs");
  assertPort(options.jobs, "get", "jobs");
  assertPort(options, "resolveSource", "runtime options");
  assertPort(options, "process", "runtime options");
  assertPort(options.contentSink, "write", "contentSink");
  if (options.indexSink) assertPort(options.indexSink, "write", "indexSink");

  const jobs = options.jobs;
  const retry = options.retry ?? createRetryPolicy();
  const lease = options.lease ?? createLeasePolicy();
  const clock = options.clock ?? Date.now;
  const random = options.random ?? Math.random;
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  const observer = options.observer;

  async function enqueue(input) {
    if (!input || typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0 || input.idempotencyKey.length > 512) {
      throw error("An ingestion job requires a non-empty idempotencyKey of at most 512 characters.", "invalid-source");
    }
    if (typeof input.format !== "string" || input.format.length === 0) {
      throw error("An ingestion job requires a document format.", "invalid-source");
    }
    const now = clock();
    const initial = {
      id: input.id ?? makeId(),
      idempotencyKey: input.idempotencyKey,
      state: "queued",
      phase: "queued",
      revision: 0,
      attempt: 0,
      maxAttempts: retry.maxAttempts,
      createdAt: now,
      updatedAt: now,
      input: {
        source: input.source,
        format: input.format.toLowerCase().replace(/^\./, ""),
        expectedSize: input.expectedSize,
        expectedSha256: input.expectedSha256,
        maxBytes: input.maxBytes,
        metadata: input.metadata,
      },
    };
    assertDurable(initial, "The ingestion job");
    const result = await jobs.create(initial);
    emit(observer, { type: result.created ? "job.enqueued" : "job.deduplicated", jobId: result.job.id, at: now });
    return result;
  }

  async function run(jobId, runOptions = {}) {
    const workerId = runOptions.workerId ?? makeId();
    let job = await jobs.claim(jobId, { workerId, durationMs: lease.durationMs, now: clock() });
    if (!job) {
      const current = await jobs.get(jobId);
      return current ? { status: "not-runnable", job: current } : { status: "not-found" };
    }
    const leaseToken = job.lease.token;
    const leaseController = new AbortController();
    const signal = runOptions.signal
      ? AbortSignal.any([runOptions.signal, leaseController.signal])
      : leaseController.signal;
    let heartbeatRunning = false;
    let heartbeatStopped = false;
    let heartbeatTask = Promise.resolve();
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || signal.aborted) return;
      heartbeatRunning = true;
      heartbeatTask = (async () => {
        try {
          const renewed = await jobs.renew(jobId, { leaseToken, durationMs: lease.durationMs, now: clock() });
          if (!renewed) leaseController.abort(error("The ingestion lease was lost.", "lease-lost", undefined, true));
          else job = renewed;
        } catch (cause) {
          leaseController.abort(asError(cause, "lease-lost", "The ingestion lease could not be renewed.", true));
        } finally {
          heartbeatRunning = false;
        }
      })();
    }, lease.heartbeatMs);
    heartbeat.unref?.();
    const stopHeartbeat = async () => {
      if (!heartbeatStopped) {
        heartbeatStopped = true;
        clearInterval(heartbeat);
      }
      await heartbeatTask;
    };
    emit(observer, { type: "job.claimed", jobId, attempt: job.attempt, workerId, at: clock() });

    const checkpoint = async (phase, patch = {}) => {
      const updated = await jobs.update(jobId, { leaseToken, now: clock(), patch: { ...patch, phase } });
      if (!updated) throw error("The ingestion lease was lost.", "lease-lost", undefined, true);
      job = updated;
      emit(observer, { type: "job.phase", jobId, phase, attempt: job.attempt, at: clock() });
    };

    try {
      await checkpoint("acquire-source");
      const source = await options.resolveSource(job.input.source, { job, signal });
      throwIfAborted(signal);

      await checkpoint("read-source");
      const read = await readSource(source, {
        maxBytes: job.input.maxBytes ?? defaultDocumentLimits.maxBytes,
        expectedSize: job.input.expectedSize,
        expectedSha256: job.input.expectedSha256,
        calculateSha256: true,
        signal,
        onProgress(progress) {
          emit(observer, { type: "source.progress", jobId, phase: "read-source", ...progress, at: clock() });
        },
      });

      await checkpoint("process");
      let artifact;
      try {
        artifact = await options.process({
          bytes: read.bytes,
          format: job.input.format,
          metadata: job.input.metadata,
          source: { byteLength: read.byteLength, contentType: read.contentType, etag: read.etag, filename: read.filename, sha256: read.sha256 },
          signal,
          reportProgress(progress) {
            emit(observer, { type: "processor.progress", jobId, phase: "process", progress, at: clock() });
          },
        });
      } catch (cause) {
        throw asError(cause, "processing-failed", "The document processor failed.");
      }
      throwIfAborted(signal);
      if (!artifact || typeof artifact !== "object" || !("content" in artifact)) {
        throw error("The processor returned no normalized content model.", "processing-failed");
      }
      if ("nativeRender" in artifact || "viewerModel" in artifact || "sourceBytes" in artifact) {
        throw error("Ingestion artifacts cannot contain native render models or source bytes.", "processing-failed");
      }
      assertDurable(artifact, "The ingestion artifact", "processing-failed");

      await checkpoint("store-content");
      let content;
      try {
        content = await options.contentSink.write({
          artifact,
          idempotencyKey: `${job.idempotencyKey}:content`,
          job,
          signal,
        });
      } catch (cause) {
        throw asError(cause, "sink-failed", "The content sink failed.", true);
      }
      throwIfAborted(signal);
      assertDurable(content, "The content sink result");

      let index;
      if (options.indexSink) {
        await checkpoint("store-index", { output: { content } });
        try {
          index = await options.indexSink.write({
            artifact,
            content,
            idempotencyKey: `${job.idempotencyKey}:index`,
            job,
            signal,
          });
        } catch (cause) {
          throw asError(cause, "sink-failed", "The index sink failed.", true);
        }
        throwIfAborted(signal);
        assertDurable(index, "The index sink result");
      }

      await stopHeartbeat();
      throwIfAborted(signal);
      await checkpoint("complete", {
        state: "succeeded",
        lease: undefined,
        output: { content, index, byteLength: read.byteLength, sha256: read.sha256 },
      });
      emit(observer, { type: "job.succeeded", jobId, attempt: job.attempt, at: clock() });
      return { status: "succeeded", job };
    } catch (cause) {
      await stopHeartbeat();
      let failure = signal.aborted
        ? asError(signal.reason ?? cause, "aborted", "The ingestion run was aborted.", true)
        : asError(cause, "processing-failed", "The ingestion run failed.");
      if (failure.code === "aborted" && runOptions.signal?.aborted && !failure.retryable) {
        failure = error(failure.message, "aborted", failure, true);
      }
      const delay = retry.nextDelay(failure, job.attempt, random);
      const nextState = delay === null ? "failed" : "retry-scheduled";
      const updated = await jobs.update(jobId, {
        leaseToken,
        now: clock(),
        patch: {
          state: nextState,
          phase: nextState,
          lease: undefined,
          error: serializeError(failure),
          nextAttemptAt: delay === null ? undefined : clock() + delay,
        },
      }).catch(() => null);
      if (updated) {
        job = updated;
        emit(observer, { type: delay === null ? "job.failed" : "job.retry-scheduled", jobId, attempt: job.attempt, error: serializeError(failure), delayMs: delay ?? undefined, at: clock() });
      } else {
        emit(observer, { type: "job.lease-lost", jobId, attempt: job.attempt, error: serializeError(failure), at: clock() });
      }
      return { status: updated ? nextState : "lease-lost", job, error: failure };
    } finally {
      await stopHeartbeat();
    }
  }

  return Object.freeze({ enqueue, get: (jobId) => jobs.get(jobId), run });
}
