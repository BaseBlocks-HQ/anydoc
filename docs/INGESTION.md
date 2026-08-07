# Headless ingestion architecture

AnyDoc ingestion is a framework-neutral execution core. It does not own a queue, database, object store, tenant authorization, or publication workflow. Those remain application concerns because their transactional and trust boundaries are product-specific.

## Package boundaries

The runtime lives in tree-shakeable subpaths of `@baseblocks/anydoc` rather than another alpha package:

| Subpath | Environment | Responsibility |
|---|---|---|
| `/ingestion` | Web and Node | job lifecycle, leases, retries, processor and sink ports, events |
| `/ingestion/conformance` | Web and Node | reusable durable job-store contract tests |
| `/persistence` | Web and Node | canonical durable-value codec, validation, decoding, and allocation-bounded measurement |
| `/sources` | Web and Node | bytes, async iterable, ReadableStream, and policy-controlled HTTP sources |
| `/sources/node` | Node only | regular-file source |
| `/memory` | Web and Node | non-durable reference implementations |

None of these subpaths imports React, viewer packages, WASM, the native parser, storage SDKs, or queue clients. Parser selection stays in the consumer and can therefore be lazy.

## Durable job state

The state progression is:

```text
queued -> running -> succeeded
  |          |  |
  |          |  +--> retry-scheduled -> running
  |          +-----> failed
  +----------------> cancelled

retry-scheduled ----> cancelled
running ------------> cancelled
```

`phase` records honest progress within `running`: `acquire-source`, `read-source`, `process`, `store-content`, `store-index`, then `complete`. It is a checkpoint, not a claim that a remote side effect has not happened. Content and index sinks must be idempotent because a worker can fail after a write but before the following checkpoint.

A production `IngestionJobStore` must provide these atomic invariants:

1. `create` uniquely indexes both `id` and `idempotencyKey`; a repeated idempotency key returns the original job.
2. `claim` admits queued jobs, eligible retry jobs, or running jobs with an expired lease. It atomically installs a new unpredictable lease token and increments `attempt` and monotonic `revision`. An expired final attempt is atomically made terminal instead of remaining stranded.
3. `renew` and `update` compare the lease token and its expiry in the same transaction. A stale or expired worker receives `null` and cannot checkpoint or complete.
4. `id`, `idempotencyKey`, `input`, `attempt`, and `createdAt` are immutable after creation. Every accepted mutation increments `revision` and sets `updatedAt` from the supplied clock.
5. Job, error, artifact, and sink-result values use AnyDoc's portable persistence grammar: `null`, booleans, finite numbers, strings, dense arrays, and plain objects with enumerable string keys. Binary is represented only as `{ "$anydoc": "binary/base64", "data": "..." }`. `undefined`, non-finite numbers, bigint, functions, symbols, cycles, accessors, symbol keys, sparse arrays, and class/platform objects such as `Date`, `Map`, `Set`, and `Blob` are rejected. Do not persist credentials, parser instances, signals, or native render models.
6. `cancel` atomically transitions queued, retrying, or running work to the
   terminal `cancelled` state, clears its lease, records an optional durable
   reason, and fences the prior worker. Repeating cancellation is idempotent;
   succeeded and failed jobs are never rewritten.

The in-memory store demonstrates these rules but provides no process durability and is not a production adapter.

Run `runIngestionJobStoreConformance(() => createYourStore())` from
`@baseblocks/anydoc/ingestion/conformance` in the adapter's own database test
environment. Its cases cover uniqueness/idempotency, atomic claims, retry
eligibility, renewal, immutable fields, lease expiry, stale-worker fencing,
cancellation, final-attempt expiry, portable values, and genuine concurrent
create/claim/cancel/update/renewal races. The exported named cases can instead
be registered individually with a host test runner.

## One-shot execution for durable frameworks

`executeIngestion()` runs exactly one attempt: resolve and verify the source,
process it, enforce artifact and persistence budgets, then invoke idempotent
content and optional index sinks. It accepts an `AbortSignal` and phase/progress
hooks, but owns no queue, lease, retry, or database state. Frameworks such as
Convex that already provide durable scheduling and transactions should compose
this primitive with their native state model instead of implementing an
`IngestionJobStore` adapter. Ordinary Node/server hosts can use the complete
runtime. `createIngestionRuntime().run()` delegates its attempt body to the same
executor, so source, processor, budget, sink, and error semantics cannot drift.

## Retry and lease behavior

Errors expose a stable `code` and `retryable` boolean. Resource limits, invalid inputs, integrity failures, and format failures are terminal by default. Transient transport/status failures, deadlines, lease loss, and sink availability can be retryable. The retry policy applies bounded exponential delay and stops at `maxAttempts`.

The reference runtime heartbeats while host processors and sinks run. It checks the combined caller/lease signal after every host callback, drains an in-flight heartbeat before final completion, and relies on the job-store compare-and-set to reject stale completion. Processors and sinks should also observe their supplied `AbortSignal` to release expensive work promptly.

`runtime.cancel()` persists cancellation before aborting a worker in the same
runtime. A worker in another process observes fencing on renewal or its next
checkpoint. A sink can already have committed before cancellation wins the
store transaction, so sink idempotency remains mandatory; cancellation cannot
roll back an external side effect.

## Output security and resource bounds

Input bounds are not output bounds: a small compressed document can expand into
a large normalized graph. Before canonicalizing an artifact or invoking either
sink, the executor walks the graph and enforces independent limits for estimated
total bytes, UTF-8 string bytes, binary bytes, entries, and nesting depth. It
then encodes raw binary with the documented envelope. Sink return values have a
separate small persistence budget. Limit failures use the typed, terminal
`output-too-large` error.

Measurement iterates keys and UTF-16 code units without constructing a complete
key list or calling `TextEncoder`; a cheap lower bound rejects impossible
strings before the exact UTF-8 scan. It counts object keys and string values as
UTF-8, ArrayBuffer and typed-array payloads as binary, and structural primitives
at fixed widths. Format processors should still
enforce semantic limits such as pages, cells, slides, archive entries, and
individual assets before constructing the complete model.

## Source security and resource bounds

`readSource` validates an advertised size before allocating, enforces the ceiling on every chunk, rejects early EOF and overrun, and incrementally calculates SHA-256 while streaming. When the size is known, it allocates exactly one final byte buffer. Unknown-size streams retain bounded chunk copies until final materialization; the single-chunk case reuses its isolated copy, while a multi-chunk source can transiently approach two times the input size because parsers require contiguous bytes. This is a memory bound, not permission to exceed `maxBytes`.

HTTP adapters follow redirects manually. On an origin change they remove all caller-supplied headers, suppress the referrer, and switch credentials to `omit`; forwarding anything across origins requires the explicit unsafe opt-in. HTTP(S) URLs with embedded credentials are always rejected. Server runtimes must provide `allowUrl`; that policy should combine scheme/host allowlists with DNS and private-address controls appropriate to the deployment. Storage credentials and signed-URL creation belong in the application source resolver, never in durable job descriptors.

`expectedSize` and `expectedSha256` bind ingestion to the version the application authorized. A mismatch produces a terminal `source-changed` or `integrity-failed` error instead of silently processing replacement bytes.

## Observability

Observers receive enqueue/deduplication, claim, phase, byte progress, processor progress, retry, cancellation/worker-stop, success, and terminal failure events. Observers are best-effort: telemetry exceptions are isolated and cannot alter document state. Durable audit requirements should be implemented transactionally in the application job-store adapter rather than relying on this hook.

## Performance gate

`pnpm run budget:ingestion` warms the path, then runs five isolated 24 MiB
unknown-length streams in 64 KiB chunks with incremental SHA-256. Every child
has a 30-second deadline. CI enforces exact materialization/integrity, median
throughput, and worst-sample ArrayBuffer and peak resident-memory growth. This tests
the runtime boundary rather than parser speed; the existing Rust benchmark and
corpus suite remain the parser performance authority.
