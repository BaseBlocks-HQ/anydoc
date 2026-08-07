# Headless ingestion architecture

AnyDoc ingestion is a framework-neutral execution core. It does not own a queue, database, object store, tenant authorization, or publication workflow. Those remain application concerns because their transactional and trust boundaries are product-specific.

## Package boundaries

The runtime lives in tree-shakeable subpaths of `@baseblocks/anydoc` rather than another alpha package:

| Subpath | Environment | Responsibility |
|---|---|---|
| `/ingestion` | Web and Node | job lifecycle, leases, retries, processor and sink ports, events |
| `/sources` | Web and Node | bytes, async iterable, ReadableStream, and policy-controlled HTTP sources |
| `/sources/node` | Node only | regular-file source |
| `/memory` | Web and Node | non-durable reference implementations |

None of these subpaths imports React, viewer packages, WASM, the native parser, storage SDKs, or queue clients. Parser selection stays in the consumer and can therefore be lazy.

## Durable job state

The state progression is:

```text
queued -> running -> succeeded
             |
             +----> retry-scheduled -> running
             |
             +----> failed
```

`phase` records honest progress within `running`: `acquire-source`, `read-source`, `process`, `store-content`, `store-index`, then `complete`. It is a checkpoint, not a claim that a remote side effect has not happened. Content and index sinks must be idempotent because a worker can fail after a write but before the following checkpoint.

A production `IngestionJobStore` must provide these atomic invariants:

1. `create` uniquely indexes both `id` and `idempotencyKey`; a repeated idempotency key returns the original job.
2. `claim` admits queued jobs, eligible retry jobs, or running jobs with an expired lease. It atomically installs a new unpredictable lease token and increments `attempt` and monotonic `revision`. An expired final attempt is atomically made terminal instead of remaining stranded.
3. `renew` and `update` compare the lease token and its expiry in the same transaction. A stale or expired worker receives `null` and cannot checkpoint or complete.
4. `id`, `idempotencyKey`, `input`, `attempt`, and `createdAt` are immutable after creation. Every accepted mutation increments `revision` and sets `updatedAt` from the supplied clock.
5. Job, error, and sink-result values are durable structured-clone data. Do not persist source bytes, parser instances, signals, functions, credentials, or native render models.

The in-memory store demonstrates these rules but provides no process durability and is not a production adapter.

## Retry and lease behavior

Errors expose a stable `code` and `retryable` boolean. Resource limits, invalid inputs, integrity failures, and format failures are terminal by default. Transient transport/status failures, deadlines, lease loss, and sink availability can be retryable. The retry policy applies bounded exponential delay and stops at `maxAttempts`.

The reference runtime heartbeats while host processors and sinks run. It checks the combined caller/lease signal after every host callback, drains an in-flight heartbeat before final completion, and relies on the job-store compare-and-set to reject stale completion. Processors and sinks should also observe their supplied `AbortSignal` to release expensive work promptly.

## Source security and resource bounds

`readSource` validates an advertised size before allocating, enforces the ceiling on every chunk, rejects early EOF and overrun, and incrementally calculates SHA-256 while streaming. When the size is known, it allocates exactly one final byte buffer. Unknown-size streams retain bounded chunks until their one final materialization.

HTTP adapters follow redirects manually. On an origin change they remove all caller-supplied headers, suppress the referrer, and switch credentials to `omit`; forwarding anything across origins requires the explicit unsafe opt-in. HTTP(S) URLs with embedded credentials are always rejected. Server runtimes must provide `allowUrl`; that policy should combine scheme/host allowlists with DNS and private-address controls appropriate to the deployment. Storage credentials and signed-URL creation belong in the application source resolver, never in durable job descriptors.

`expectedSize` and `expectedSha256` bind ingestion to the version the application authorized. A mismatch produces a terminal `source-changed` or `integrity-failed` error instead of silently processing replacement bytes.

## Observability

Observers receive enqueue/deduplication, claim, phase, byte progress, processor progress, retry, success, and terminal failure events. Observers are best-effort: telemetry exceptions are isolated and cannot alter document state. Durable audit requirements should be implemented transactionally in the application job-store adapter rather than relying on this hook.
