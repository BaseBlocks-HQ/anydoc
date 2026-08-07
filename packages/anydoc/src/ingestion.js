import { DocumentPlatformError, defaultDocumentLimits } from "@baseblocks/anydoc-contracts";
import { encodePersistenceValue, measurePersistenceValue } from "./persistence.js";
import { readSource } from "./sources.js";

export const ingestionRuntimeCapabilities = Object.freeze({
  durableCancellation: true,
  durableJobs: true,
  idempotentSinks: true,
  leaseRecovery: true,
  nativeRenderModels: false,
  outputBudgets: true,
  portablePersistence: true,
  verifiedStreamingReads: true,
});

export function createArtifactLimits(options = {}) {
  const limits = {
    maxArtifactBytes: options.maxArtifactBytes ?? 128 * 1024 * 1024,
    maxTextBytes: options.maxTextBytes ?? defaultDocumentLimits.maxTextBytes,
    maxBinaryBytes: options.maxBinaryBytes ?? defaultDocumentLimits.maxBytes,
    maxSinkResultBytes: options.maxSinkResultBytes ?? 1024 * 1024,
    maxEntries: options.maxEntries ?? 500_000,
    maxDepth: options.maxDepth ?? 128,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw error(`${name} must be a non-negative safe integer.`, "invalid-source");
    }
  }
  return Object.freeze(limits);
}

export function measureIngestionArtifact(artifact, options = {}) {
  const limits = createArtifactLimits(options);
  return measurePersistenceValue(artifact, {
    maxBytes: limits.maxArtifactBytes,
    maxTextBytes: limits.maxTextBytes,
    maxBinaryBytes: limits.maxBinaryBytes,
    maxEntries: limits.maxEntries,
    maxDepth: limits.maxDepth,
    name: "The ingestion artifact",
    code: "processing-failed",
  });
}

function error(message, code, cause, retryable = false) {
  return new DocumentPlatformError(message, { code, cause, retryable });
}

function asError(cause, fallbackCode, fallbackMessage, retryable = false) {
  if (cause instanceof DocumentPlatformError) return cause;
  return error(fallbackMessage, fallbackCode, cause, retryable);
}

function serializeError(value) {
  return {
    name: value.name,
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    ...(value.status === undefined ? {} : { status: value.status }),
  };
}

function assertPort(value, method, name) {
  if (!value || typeof value[method] !== "function") {
    throw error(`${name} must implement ${method}().`, "invalid-source");
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

function normalizeFormat(format) {
  if (typeof format !== "string" || format.length === 0) {
    throw error("Ingestion requires a document format.", "invalid-source");
  }
  return format.toLowerCase().replace(/^\./, "");
}

/**
 * Execute one bounded ingestion attempt without owning queue, lease, or retry
 * state. Durable runtimes delegate their attempt body here; serverless durable
 * frameworks can call it directly from their own scheduler/transaction model.
 */
export async function executeIngestion(options) {
  assertPort(options, "resolveSource", "execution options");
  assertPort(options, "process", "execution options");
  assertPort(options?.contentSink, "write", "contentSink");
  if (options.indexSink) assertPort(options.indexSink, "write", "indexSink");
  if (typeof options.idempotencyKey !== "string" || options.idempotencyKey.length === 0 || options.idempotencyKey.length > 512) {
    throw error("Ingestion requires a non-empty idempotencyKey of at most 512 characters.", "invalid-source");
  }

  const format = normalizeFormat(options.format);
  const signal = options.signal ?? new AbortController().signal;
  const deadline = options.deadline;
  const artifactLimits = createArtifactLimits(options.artifactLimits);
  const phase = async (name, checkpoint = {}) => {
    throwIfAborted(signal);
    await options.onPhase?.(name, checkpoint);
    throwIfAborted(signal);
  };

  await phase("acquire-source");
  let source;
  try {
    source = await options.resolveSource(options.source, { signal });
  } catch (cause) {
    throwIfAborted(signal);
    throw asError(cause, "fetch-failed", "The document source could not be resolved.");
  }
  throwIfAborted(signal);

  await phase("read-source");
  const read = await readSource(source, {
    maxBytes: options.maxBytes ?? defaultDocumentLimits.maxBytes,
    expectedSize: options.expectedSize,
    expectedSha256: options.expectedSha256,
    calculateSha256: true,
    deadline,
    signal,
    onProgress: options.onSourceProgress,
  });

  await phase("process");
  let artifact;
  try {
    artifact = await options.process({
      bytes: read.bytes,
      format,
      metadata: options.metadata,
      source: {
        byteLength: read.byteLength,
        ...(read.contentType === undefined ? {} : { contentType: read.contentType }),
        ...(read.etag === undefined ? {} : { etag: read.etag }),
        ...(read.filename === undefined ? {} : { filename: read.filename }),
        ...(read.sha256 === undefined ? {} : { sha256: read.sha256 }),
      },
      signal,
      reportProgress(progress) { options.onProcessorProgress?.(progress); },
    });
  } catch (cause) {
    throwIfAborted(signal);
    throw asError(cause, "processing-failed", "The document processor failed.");
  }
  throwIfAborted(signal);
  if (!artifact || typeof artifact !== "object" || !("content" in artifact)) {
    throw error("The processor returned no normalized content model.", "processing-failed");
  }
  const persistentArtifact = encodePersistenceValue(artifact, {
    name: "The ingestion artifact",
    code: "processing-failed",
    maxBytes: artifactLimits.maxArtifactBytes,
    maxTextBytes: artifactLimits.maxTextBytes,
    maxBinaryBytes: artifactLimits.maxBinaryBytes,
    maxEntries: artifactLimits.maxEntries,
    maxDepth: artifactLimits.maxDepth,
    forbiddenKeys: new Set(["nativeRender", "viewerModel", "sourceBytes"]),
  }).value;

  await phase("store-content");
  let content;
  try {
    content = await options.contentSink.write({
      artifact: persistentArtifact,
      idempotencyKey: `${options.idempotencyKey}:content`,
      signal,
    });
  } catch (cause) {
    throwIfAborted(signal);
    throw asError(cause, "sink-failed", "The content sink failed.", true);
  }
  throwIfAborted(signal);
  content = encodePersistenceValue(content, {
    name: "The content sink result",
    code: "sink-failed",
    maxBytes: artifactLimits.maxSinkResultBytes,
    maxTextBytes: artifactLimits.maxSinkResultBytes,
    maxBinaryBytes: artifactLimits.maxSinkResultBytes,
    maxEntries: artifactLimits.maxEntries,
    maxDepth: artifactLimits.maxDepth,
  }).value;

  let index;
  if (options.indexSink) {
    await phase("store-index", { content });
    try {
      index = await options.indexSink.write({
        artifact: persistentArtifact,
        content,
        idempotencyKey: `${options.idempotencyKey}:index`,
        signal,
      });
    } catch (cause) {
      throwIfAborted(signal);
      throw asError(cause, "sink-failed", "The index sink failed.", true);
    }
    throwIfAborted(signal);
    index = encodePersistenceValue(index, {
      name: "The index sink result",
      code: "sink-failed",
      maxBytes: artifactLimits.maxSinkResultBytes,
      maxTextBytes: artifactLimits.maxSinkResultBytes,
      maxBinaryBytes: artifactLimits.maxSinkResultBytes,
      maxEntries: artifactLimits.maxEntries,
      maxDepth: artifactLimits.maxDepth,
    }).value;
  }

  return Object.freeze({
    output: Object.freeze({
      content,
      ...(index === undefined ? {} : { index }),
      byteLength: read.byteLength,
      ...(read.sha256 === undefined ? {} : { sha256: read.sha256 }),
    }),
    source: Object.freeze({
      byteLength: read.byteLength,
      ...(read.contentType === undefined ? {} : { contentType: read.contentType }),
      ...(read.etag === undefined ? {} : { etag: read.etag }),
      ...(read.filename === undefined ? {} : { filename: read.filename }),
      ...(read.sha256 === undefined ? {} : { sha256: read.sha256 }),
    }),
  });
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
  assertPort(options.jobs, "cancel", "jobs");
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
  const artifactLimits = createArtifactLimits(options.artifactLimits);
  const activeRuns = new Map();

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
        format: normalizeFormat(input.format),
        ...(input.expectedSize === undefined ? {} : { expectedSize: input.expectedSize }),
        ...(input.expectedSha256 === undefined ? {} : { expectedSha256: input.expectedSha256 }),
        ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    };
    const persistentInitial = encodePersistenceValue(initial, {
      name: "The ingestion job",
      code: "invalid-source",
      maxBytes: 2 * 1024 * 1024,
      maxTextBytes: 1024 * 1024,
      maxBinaryBytes: 0,
      maxEntries: 50_000,
      maxDepth: 64,
    }).value;
    const result = await jobs.create(persistentInitial);
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
    const durableCancellationController = new AbortController();
    const controllers = activeRuns.get(jobId) ?? new Set();
    controllers.add(durableCancellationController);
    activeRuns.set(jobId, controllers);
    const signal = runOptions.signal
      ? AbortSignal.any([runOptions.signal, leaseController.signal, durableCancellationController.signal])
      : AbortSignal.any([leaseController.signal, durableCancellationController.signal]);
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
      let updated;
      try {
        updated = await jobs.update(jobId, { leaseToken, now: clock(), patch: { ...patch, phase } });
      } catch (cause) {
        throw error("The ingestion checkpoint could not be persisted.", "lease-lost", cause, true);
      }
      if (!updated) throw error("The ingestion lease was lost.", "lease-lost", undefined, true);
      job = updated;
      emit(observer, { type: "job.phase", jobId, phase, attempt: job.attempt, at: clock() });
    };

    try {
      const execution = await executeIngestion({
        source: job.input.source,
        format: job.input.format,
        expectedSize: job.input.expectedSize,
        expectedSha256: job.input.expectedSha256,
        maxBytes: job.input.maxBytes,
        metadata: job.input.metadata,
        idempotencyKey: job.idempotencyKey,
        artifactLimits,
        signal,
        resolveSource: (descriptor, context) => options.resolveSource(descriptor, { ...context, job }),
        process: options.process,
        contentSink: {
          write: (input) => options.contentSink.write({ ...input, job }),
        },
        ...(options.indexSink ? {
          indexSink: {
            write: (input) => options.indexSink.write({ ...input, job }),
          },
        } : {}),
        async onPhase(phase, executionCheckpoint) {
          await checkpoint(phase, phase === "store-index" ? { output: { content: executionCheckpoint.content } } : {});
        },
        onSourceProgress(progress) {
          emit(observer, { type: "source.progress", jobId, phase: "read-source", ...progress, at: clock() });
        },
        onProcessorProgress(progress) {
          emit(observer, { type: "processor.progress", jobId, phase: "process", progress, at: clock() });
        },
      });

      await stopHeartbeat();
      throwIfAborted(signal);
      await checkpoint("complete", {
        state: "succeeded",
        lease: undefined,
        output: execution.output,
      });
      emit(observer, { type: "job.succeeded", jobId, attempt: job.attempt, at: clock() });
      return { status: "succeeded", job };
    } catch (cause) {
      await stopHeartbeat();
      const current = await jobs.get(jobId).catch(() => null);
      if (current?.state === "cancelled") {
        const cancellation = error(current.cancellation?.reason ?? "The ingestion job was cancelled.", "aborted");
        emit(observer, { type: "job.worker-cancelled", jobId, attempt: job.attempt, at: clock() });
        return { status: "cancelled", job: current, error: cancellation };
      }
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
      controllers.delete(durableCancellationController);
      if (controllers.size === 0) activeRuns.delete(jobId);
    }
  }

  async function cancel(jobId, cancelOptions = {}) {
    const reason = cancelOptions.reason;
    if (reason !== undefined && (typeof reason !== "string" || reason.length === 0 || reason.length > 1_024)) {
      throw error("A cancellation reason must be a non-empty string of at most 1,024 characters.", "invalid-source");
    }
    const now = clock();
    const cancelled = await jobs.cancel(jobId, { now, reason });
    if (!cancelled) {
      const current = await jobs.get(jobId);
      return current ? { status: "not-cancellable", job: current } : { status: "not-found" };
    }
    const cancellation = error(reason ?? "The ingestion job was cancelled.", "aborted");
    for (const controller of activeRuns.get(jobId) ?? []) controller.abort(cancellation);
    emit(observer, { type: "job.cancelled", jobId, attempt: cancelled.attempt, at: now });
    return { status: "cancelled", job: cancelled };
  }

  return Object.freeze({ cancel, enqueue, get: (jobId) => jobs.get(jobId), run });
}
