import { DocumentPlatformError } from "@baseblocks/anydoc-contracts";

function assert(condition, message) {
  if (!condition) throw new Error(`IngestionJobStore conformance failure: ${message}`);
}

async function rejectsConflict(task, message) {
  try {
    await task();
  } catch (cause) {
    assert(cause instanceof DocumentPlatformError || cause?.code === "job-conflict", `${message} must reject with job-conflict`);
    assert(cause.code === "job-conflict", `${message} must use the job-conflict code`);
    return;
  }
  throw new Error(`IngestionJobStore conformance failure: ${message} must reject`);
}

function job(id, key, overrides = {}) {
  return {
    id,
    idempotencyKey: key,
    state: "queued",
    phase: "queued",
    revision: 0,
    attempt: 0,
    maxAttempts: 3,
    createdAt: 1,
    updatedAt: 1,
    input: { source: { key: id }, format: "docx" },
    ...overrides,
  };
}

const cases = [
  {
    name: "uniqueness and idempotency",
    async run(createStore) {
      const store = await createStore();
      const first = await store.create(job("first", "tenant:document:v1"));
      assert(first.created === true, "the first create must report created");
      const duplicate = await store.create(job("duplicate-id", "tenant:document:v1"));
      assert(duplicate.created === false && duplicate.job.id === "first", "an idempotency replay must return the original job");
      await store.create(job("second", "tenant:other:v1"));
      await rejectsConflict(() => store.create(job("first", "tenant:third:v1")), "duplicate ids");
      await rejectsConflict(() => store.create(job("second", "tenant:document:v1")), "crossed id and idempotency keys");
    },
  },
  {
    name: "atomic claims and retry eligibility",
    async run(createStore) {
      const store = await createStore();
      await store.create(job("claim", "claim"));
      const claimed = await store.claim("claim", { workerId: "worker-a", durationMs: 1_000, now: 10 });
      assert(claimed?.state === "running" && claimed.attempt === 1 && claimed.revision === 1, "claim must atomically advance state, attempt, and revision");
      assert(await store.claim("claim", { workerId: "worker-b", durationMs: 1_000, now: 11 }) === null, "an active lease must not be claimed twice");
      const retry = await store.update("claim", {
        leaseToken: claimed.lease.token,
        now: 12,
        patch: { state: "retry-scheduled", phase: "retry-scheduled", lease: undefined, nextAttemptAt: 20 },
      });
      assert(retry?.state === "retry-scheduled", "the active worker must be able to schedule a retry");
      assert(await store.claim("claim", { workerId: "worker-b", durationMs: 1_000, now: 19 }) === null, "a retry must not run early");
      assert((await store.claim("claim", { workerId: "worker-b", durationMs: 1_000, now: 20 }))?.attempt === 2, "an eligible retry must be claimable");
    },
  },
  {
    name: "renewal and mutation fencing",
    async run(createStore) {
      const store = await createStore();
      await store.create(job("fence", "fence"));
      const claimed = await store.claim("fence", { workerId: "worker", durationMs: 100, now: 10 });
      assert(await store.renew("fence", { leaseToken: "wrong", durationMs: 100, now: 11 }) === null, "a wrong token must not renew a lease");
      const renewed = await store.renew("fence", { leaseToken: claimed.lease.token, durationMs: 100, now: 11 });
      assert(renewed?.lease.expiresAt === 111 && renewed.revision === claimed.revision + 1, "renewal must extend expiry and revision atomically");
      assert(await store.update("fence", { leaseToken: claimed.lease.token, now: 112, patch: { phase: "process" } }) === null, "an expired token must not mutate a job");
      await rejectsConflict(
        () => store.update("fence", { leaseToken: claimed.lease.token, now: 12, patch: { input: { source: {}, format: "pdf" } } }),
        "immutable job fields",
      );
    },
  },
  {
    name: "lease expiry recovery and stale-worker fencing",
    async run(createStore) {
      const store = await createStore();
      await store.create(job("expiry", "expiry"));
      const oldClaim = await store.claim("expiry", { workerId: "old", durationMs: 10, now: 0 });
      const replacement = await store.claim("expiry", { workerId: "new", durationMs: 10, now: 11 });
      assert(replacement?.attempt === 2 && replacement.lease.token !== oldClaim.lease.token, "an expired lease must receive a new fenced claim");
      assert(await store.renew("expiry", { leaseToken: oldClaim.lease.token, durationMs: 10, now: 11 }) === null, "the stale worker must not renew");
      assert(await store.update("expiry", { leaseToken: oldClaim.lease.token, now: 11, patch: { phase: "complete" } }) === null, "the stale worker must not checkpoint");
    },
  },
  {
    name: "durable cancellation",
    async run(createStore) {
      const store = await createStore();
      await store.create(job("cancel-queued", "cancel-queued"));
      const queued = await store.cancel("cancel-queued", { now: 5 });
      assert(queued?.state === "cancelled" && queued.attempt === 0, "queued jobs must be cancellable without creating an attempt");

      await store.create(job("cancel-retry", "cancel-retry"));
      const retryClaim = await store.claim("cancel-retry", { workerId: "retry-worker", durationMs: 1_000, now: 6 });
      await store.update("cancel-retry", {
        leaseToken: retryClaim.lease.token,
        now: 7,
        patch: { state: "retry-scheduled", phase: "retry-scheduled", lease: undefined, nextAttemptAt: 100 },
      });
      assert((await store.cancel("cancel-retry", { now: 8 }))?.state === "cancelled", "retry-scheduled jobs must be cancellable");

      await store.create(job("cancel", "cancel"));
      const claimed = await store.claim("cancel", { workerId: "worker", durationMs: 1_000, now: 10 });
      const cancelled = await store.cancel("cancel", { now: 11, reason: "authorization revoked" });
      assert(cancelled?.state === "cancelled" && cancelled.phase === "cancelled", "cancellation must be terminal");
      assert(cancelled.lease === undefined && cancelled.cancellation?.reason === "authorization revoked", "cancellation must clear the lease and persist its reason");
      assert(cancelled.revision === claimed.revision + 1, "cancellation must increment revision");
      assert(await store.renew("cancel", { leaseToken: claimed.lease.token, durationMs: 1_000, now: 12 }) === null, "a cancelled worker must not renew");
      assert(await store.update("cancel", { leaseToken: claimed.lease.token, now: 12, patch: { state: "succeeded" } }) === null, "a cancelled worker must not complete");
      assert(await store.claim("cancel", { workerId: "replacement", durationMs: 1_000, now: 2_000 }) === null, "cancelled jobs must never be reclaimed");
      assert((await store.cancel("cancel", { now: 13 }))?.revision === cancelled.revision, "repeated cancellation must be idempotent");
    },
  },
  {
    name: "terminal-state cancellation and final-attempt expiry",
    async run(createStore) {
      const store = await createStore();
      await store.create(job("final", "final", { maxAttempts: 1 }));
      await store.claim("final", { workerId: "worker", durationMs: 10, now: 0 });
      assert(await store.claim("final", { workerId: "replacement", durationMs: 10, now: 11 }) === null, "an expired final attempt must not be reclaimed");
      const failed = await store.get("final");
      assert(failed?.state === "failed" && failed.lease === undefined, "an expired final attempt must become failed");
      assert(failed.error?.code === "lease-lost", "final lease expiry must retain a stable error code");
      assert(await store.cancel("final", { now: 12 }) === null, "failed jobs must not be rewritten as cancelled");
    },
  },
];

export const ingestionJobStoreConformanceTests = Object.freeze(cases.map((entry) => Object.freeze(entry)));

export async function runIngestionJobStoreConformance(createStore) {
  if (typeof createStore !== "function") throw new TypeError("createStore must be a function returning a fresh IngestionJobStore.");
  const passed = [];
  for (const entry of ingestionJobStoreConformanceTests) {
    await entry.run(createStore);
    passed.push(entry.name);
  }
  return Object.freeze({ passed: Object.freeze(passed), total: passed.length });
}
