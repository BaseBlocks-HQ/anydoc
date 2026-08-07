# AnyDoc platform (alpha)

`@baseblocks/anydoc` is the high-level ingestion and viewing surface for the
AnyDoc platform. The common path is intentionally small: bounded source reads,
format detection, parser loading, and safe defaults live in the package.

For ingestion without viewers, install the umbrella package:

```bash
npm install @baseblocks/anydoc
```

The ingestion subpaths are runtime-light and do not import React, viewer code,
WASM, or the native parser until you select those entry points. The umbrella
installation itself is not dependency-free: it includes `@firecrawl/anydoc`
and the platform-applicable optional native parser package.

The umbrella package installs the optional viewer implementations automatically.
Applications still import through `@baseblocks/anydoc` subpaths:

```bash
npm install @baseblocks/anydoc react react-dom
```

```ts
import { ingest } from "@baseblocks/anydoc/node";

const document = await ingest("report.docx");
document.markdown;     // clean Markdown; index directly or transform for your search engine
document.source.sha256;
```

`ingest` also accepts `File`, `Blob`, bytes, or an explicit `DocumentSource`.
Use `@baseblocks/anydoc/browser` for the same API with lazy WASM. Browser URL
ingestion requires an explicit `allowUrl` policy; `File`, `Blob`, and bytes do not.
Reads are bounded and checksummed by default. Pass `includeDocument: true` only
when the normalized graph and embedded assets are needed; the fast default does
one conversion.

## One universal viewer

```tsx
import { AnyDocumentViewer } from "@baseblocks/anydoc/react";

<AnyDocumentViewer source={fileOrUrlOrBytes} filename="report.docx" />
```

The viewer detects the format from explicit metadata, filenames, MIME types, or
supported signatures, then lazy-loads only the PDF/DOCX/text, presentation, or
spreadsheet family it needs. All families expose the same pagination, zoom,
search, action, status, and details model.

Controls can be hidden, observed headlessly, modified, replaced, or portaled
into an existing application toolbar without format-specific adapters:

```tsx
<AnyDocumentViewer
  source={file}
  controls={{
    target: toolbarElement,
    transform: (controls) => ({
      ...controls,
      actions: controls.actions.filter((action) => action.id !== "appearance"),
    }),
    render: (controls, defaults) => <MyToolbar controls={controls}>{defaults}</MyToolbar>,
  }}
  onControls={(controls) => documentCommands.set(controls)}
/>
```

`controls={false}` is the headless form. `onControls` still receives live
commands, so the host can render them anywhere.

## Durable Convex ingestion

One-shot ingestion does not pretend to be a durable queue. Convex applications
should use `@baseblocks/anydoc-convex`, which delegates scheduling, concurrency,
retries, cancellation, and reactive status to the official Workpool component.

```ts
// convex/convex.config.ts
import workpool from "@convex-dev/workpool/convex.config.js";

app.use(workpool, { name: "anydoc" });
```

```ts
// convex/anydoc.ts (`use node`)
import { createConvexIngestionHandler } from "@baseblocks/anydoc-convex/node";

export const run = internalAction({
  args: ingestionArgs,
  handler: createConvexIngestionHandler({
    resolveSource: async (ctx, job) => (await ctx.storage.get(job.source.storageId))!,
    writeResult: (ctx, job, result) => ctx.runMutation(internal.documents.storeExtracted, {
      idempotencyKey: job.idempotencyKey,
      documentId: job.source.documentId,
      markdown: result.markdown,
      sha256: result.source.sha256,
    }),
  }),
});

// convex/documentQueue.ts (the normal Convex runtime)
import { ConvexIngestionQueue } from "@baseblocks/anydoc-convex";

export const queue = new ConvexIngestionQueue(components.anydoc, internal.anydoc.run, {
  binding: documentIngestionBinding,
  onComplete: internal.documents.extractionCompleted,
});
// In a mutation: const receipt = await queue.enqueue(ctx, job)
// In a query:    await queue.status(ctx, receipt)
// In a mutation: await queue.cancel(ctx, receipt)
```

The small `documentIngestionBinding` projects `{ entityId, sourceVersion,
generation, idempotencyKey, workId, state }` onto the app's document record. It
atomically deduplicates enqueue and increments/fences generations before
cancellation. The result mutation must compare the same source version and
generation while upserting by `idempotencyKey`, then return `{ status:
"applied" }` or `{ status: "superseded" }`. Run the exported binding conformance
suite against this adapter. Authorization is checked when enqueueing and
revalidated while resolving the private source in the action.

The package root is safe in ordinary Convex mutations/queries; only the `/node`
entrypoint loads document processing. A job may set `attemptTimeoutMs`; the
handler creates a fresh absolute deadline for every retry. In completion
mutations, call `decodeConvexIngestionFailure(args.result)` to recover a stable
error code, retryability, and resource limits from Workpool's string error
channel.

## Headless ingestion runtime

The ingestion runtime is a set of ports, not a queue, database, or storage SDK. Applications retain authorization, scheduling, credentials, publication state, and vendor choices. AnyDoc owns the reusable safety and execution semantics:

- `@baseblocks/anydoc/sources` — bounded Web/stream/bytes reads, incremental SHA-256, exact-size verification, deadlines, and redirect policy.
- `@baseblocks/anydoc/sources/node` — regular-file sources without pulling Node built-ins into Web bundles.
- `@baseblocks/anydoc/ingestion` — durable job, cancellation, lease, retry, idempotency, output-budget, progress, content-sink, and index-sink contracts.
- `@baseblocks/anydoc/ingestion/conformance` — a test-runner-neutral contract suite for durable job-store adapters.
- `@baseblocks/anydoc/memory` — reference job store and sinks for tests and local tools, not a durable production backend.

```ts
import { toDocument } from "@baseblocks/anydoc/node";
import { createIngestionRuntime } from "@baseblocks/anydoc/ingestion";
import { bytesSource } from "@baseblocks/anydoc/sources";

const runtime = createIngestionRuntime({
  jobs, // your durable IngestionJobStore
  resolveSource: async ({ storageKey }) => {
    // Fetch credentials and authorization stay in the application adapter.
    const bytes = await storage.read(storageKey);
    return bytesSource(bytes);
  },
  process: async ({ bytes, format }) => ({
    content: await toDocument(bytes, format),
    format,
  }),
  contentSink,
  indexSink,
  observer: (event) => telemetry.emit(event),
});

const { job } = await runtime.enqueue({
  idempotencyKey: `${tenantId}:${documentId}:${sourceVersion}`,
  source: { storageKey },
  format: "docx",
  expectedSize,
  expectedSha256,
});
await runtime.run(job.id, { workerId });

// Deletion, authorization revocation, or an explicit user action can cancel
// queued, retrying, or active work durably. Active workers are fenced.
await runtime.cancel(job.id, { reason: "authorization revoked" });
```

Source descriptors and job metadata must use AnyDoc's finite portable persistence grammar; never put credentials in them. Import `encodePersistenceValue`, `decodePersistenceValue`, and allocation-bounded measurement from `@baseblocks/anydoc/persistence`. Binary is persisted as a documented base64 envelope, while cycles, platform/class objects, bigint, non-finite numbers, and executable values are rejected. Sink writes receive stable, phase-specific idempotency keys. A retry after interruption may call a sink again, so a production sink must atomically return its prior result for the same key.

Normalized artifacts are measured and canonicalized before sink writes.
Default budgets independently cap total estimated artifact bytes, UTF-8 text,
binary data, graph entries/depth, and persisted sink results. Override
`artifactLimits` deliberately for a trusted workload; an exceeded budget fails
terminally with `output-too-large`.

The normalized `artifact.content` model is deliberately separate from native viewer state. The runtime recursively rejects artifacts containing `nativeRender`, `viewerModel`, or `sourceBytes` at any depth; native viewers continue to consume original bounded source bytes through their lazy format packages.

For other hosts that already own durable scheduling and transactions, call
`executeIngestion()` from `@baseblocks/anydoc/ingestion`. It executes one
verified, bounded attempt with content/index sinks, cancellation, and an optional
absolute source-read `deadline`, but adds no
queue, lease, retry, or persistence abstraction. The complete portable durable runtime
uses this same executor internally.

See [the ingestion architecture](../../docs/INGESTION.md) for store invariants, state transitions, source security, and adapter guidance.

The default entry point contains only capability/security contracts and a lazy adapter registry. PDF, DOCX, spreadsheet, and PPTX dependencies are loaded through explicit format adapters so ingestion-only consumers do not pay their cost. Hosts provide the concrete React/headless renderer and worker URLs appropriate to their bundler.

## Security contract

Documents are untrusted. Adapters must enforce bounded bytes/pages/cells/slides, disable macros/scripts/formulas/external references, block external media by default, and expose structured errors. `isSafeExternalUrl`, `sanitizeFilename`, and `createAbortScope` are small shared primitives for hosts.

Server-side `webSource` requires an explicit `allowUrl` callback. The host must resolve its own DNS/private-network policy; URL syntax checks alone do not prevent SSRF or DNS rebinding. Cross-origin redirects strip all caller-supplied headers, credentials, and referrers unless the caller makes an explicit unsafe opt-in. Embedded URL credentials are always rejected.

## Capability matrix

| Format | Native viewer | Alpha policy |
|---|---:|---|
| text / Markdown | Yes | Bounded, inert text; Markdown must be AST-sanitized and remote images blocked |
| PDF | Yes | PDF.js worker and bounded virtual pages; scripts/XFA/forms/launches disabled |
| DOCX | Yes | Safe renderer; no macros, OLE, or external relationships |
| XLSX / CSV | Yes | Worker-backed virtualized grid; formulas and external references inert |
| PPTX | Yes | Lazy slides/media; external media and playback blocked |

DOC/DOCM, XLS/XLSM/XLSB, PPT/PPS/POT/PPTM/PPSX/PPSM, ODT/ODS/ODP, RTF, and EPUB are ingestion-supported but not claimed as native viewers in v1. Scanned/image-only PDFs remain visually viewable but require a future OCR pipeline for semantic ingestion.
