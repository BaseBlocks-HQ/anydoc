# `@baseblocks/anydoc-convex`

Durable AnyDoc ingestion for Convex without rebuilding queues, leases, retries,
or status tables in every application. It delegates those concerns to the
official `@convex-dev/workpool` component.

The application keeps only the boundaries that cannot safely live in a shared
component: authorization, private storage access, its result schema, and a
single CAS projection on the owning entity. The projection deduplicates
`idempotencyKey`, tracks `sourceVersion`/`generation`/`workId`, and fences stale
in-flight writes after source replacement or cancellation.
See the root AnyDoc README for complete setup and an action example.

Import queue and binding APIs from the runtime-safe package root. Node document
processing is intentionally isolated so ordinary Convex mutations and queries
never bundle filesystem or native parser code:

```ts
import { ConvexIngestionQueue } from "@baseblocks/anydoc-convex";
// In a `use node` action module only:
import { createConvexIngestionHandler } from "@baseblocks/anydoc-convex/node";
```

The Node entry also exports `iterableSource`, so storage-backed actions can
stream S3/R2/Convex data without adding a direct ingestion dependency or
importing parser internals.

Bindings are generic over the application's complete mutation and query
contexts, so their atomic CAS methods can use `ctx.db` directly. Jobs specify
`attemptTimeoutMs`, a duration converted into a fresh deadline inside every
Workpool attempt. Never persist an absolute deadline across retries.

Workpool exposes completion errors as strings. The handler carries AnyDoc's
stable error code, retryability, format/status, and known resource limits in
that channel. Decode it in an `onComplete` mutation with
`decodeConvexIngestionFailure(args.result)` from the package root.
