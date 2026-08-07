import { DocumentPlatformError } from "@baseblocks/anydoc-contracts";

const clone = (value) => value === undefined ? undefined : structuredClone(value);

function validateJob(job) {
  try {
    return clone(job);
  } catch (cause) {
    throw new DocumentPlatformError("Ingestion jobs must contain durable structured-clone data.", {
      cause,
      code: "invalid-source",
    });
  }
}

export function createMemoryJobStore(options = {}) {
  const records = new Map();
  const idempotency = new Map();
  const makeToken = options.makeToken ?? (() => globalThis.crypto.randomUUID());

  return Object.freeze({
    async create(input) {
      const existingId = idempotency.get(input.idempotencyKey);
      if (existingId) {
        if (records.has(input.id) && input.id !== existingId) {
          throw new DocumentPlatformError("The ingestion job id and idempotency key identify different jobs.", { code: "job-conflict" });
        }
        return { job: clone(records.get(existingId)), created: false };
      }
      if (records.has(input.id)) {
        throw new DocumentPlatformError("An ingestion job with this id already exists.", { code: "job-conflict" });
      }
      const job = validateJob(input);
      records.set(job.id, job);
      idempotency.set(job.idempotencyKey, job.id);
      return { job: clone(job), created: true };
    },
    async get(id) {
      return clone(records.get(id) ?? null);
    },
    async claim(id, { workerId, durationMs, now }) {
      const current = records.get(id);
      if (!current) return null;
      const retryReady = current.state === "retry-scheduled" && (current.nextAttemptAt ?? 0) <= now;
      const abandoned = current.state === "running" && current.lease?.expiresAt <= now;
      if (current.state !== "queued" && !retryReady && !abandoned) return null;
      if (current.attempt >= current.maxAttempts) {
        if (abandoned) {
          records.set(id, {
            ...current,
            state: "failed",
            phase: "failed",
            revision: current.revision + 1,
            updatedAt: now,
            lease: undefined,
            error: {
              name: "DocumentPlatformError",
              code: "lease-lost",
              message: "The final ingestion attempt expired before completion.",
              retryable: false,
            },
          });
        }
        return null;
      }
      const next = {
        ...current,
        state: "running",
        phase: "acquire-source",
        attempt: current.attempt + 1,
        revision: current.revision + 1,
        updatedAt: now,
        nextAttemptAt: undefined,
        error: undefined,
        lease: { owner: workerId, token: makeToken(), expiresAt: now + durationMs },
      };
      records.set(id, next);
      return clone(next);
    },
    async renew(id, { leaseToken, durationMs, now }) {
      const current = records.get(id);
      if (!current || current.state !== "running" || current.lease?.token !== leaseToken || current.lease.expiresAt <= now) return null;
      const next = {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        lease: { ...current.lease, expiresAt: now + durationMs },
      };
      records.set(id, next);
      return clone(next);
    },
    async update(id, { leaseToken, now, patch }) {
      const current = records.get(id);
      if (!current || current.state !== "running" || current.lease?.token !== leaseToken || current.lease.expiresAt <= now) return null;
      if (["id", "idempotencyKey", "input", "attempt", "maxAttempts", "createdAt", "revision", "updatedAt"].some((key) => Object.hasOwn(patch, key))) {
        throw new DocumentPlatformError("Immutable ingestion job fields cannot be changed.", { code: "job-conflict" });
      }
      const next = validateJob({ ...current, ...patch, id, revision: current.revision + 1, updatedAt: now });
      records.set(id, next);
      return clone(next);
    },
    /** Test/reference inspection only; production stores should not expose scans. */
    async list() {
      return [...records.values()].map(clone);
    },
  });
}

function createMemorySink(kind) {
  const values = new Map();
  return Object.freeze({
    async write(input) {
      if (values.has(input.idempotencyKey)) return clone(values.get(input.idempotencyKey).result);
      const result = { ref: `${kind}:${input.idempotencyKey}` };
      values.set(input.idempotencyKey, { input: clone({ ...input, signal: undefined }), result });
      return clone(result);
    },
    get(idempotencyKey) {
      return clone(values.get(idempotencyKey) ?? null);
    },
    size() {
      return values.size;
    },
  });
}

export function createMemoryContentSink() { return createMemorySink("content"); }
export function createMemoryIndexSink() { return createMemorySink("index"); }
