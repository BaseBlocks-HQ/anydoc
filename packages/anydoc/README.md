# AnyDoc platform (alpha)

This is the temporary `@baseblocks/anydoc` distribution for the AnyDoc platform alpha. It exposes the existing native Node ingestion API through `@baseblocks/anydoc/node`, a lazy browser WASM API through `@baseblocks/anydoc/browser`, and format-native React viewers through lazy subpackages. The normalized content model remains separate from native render models; viewers consume original source bytes and never render extracted Markdown as a fidelity substitute.

For ingestion without viewers, install the umbrella package:

```bash
npm install @baseblocks/anydoc
```

The ingestion subpaths are runtime-light and do not import React, viewer code,
WASM, or the native parser until you select those entry points. The umbrella
installation itself is not dependency-free: it includes `@firecrawl/anydoc`
and the platform-applicable optional native parser package.

For the complete native viewer surface, install the optional implementations once; application code still imports through `@baseblocks/anydoc` subpaths:

```bash
npm install @baseblocks/anydoc @baseblocks/anydoc-react-viewer \
  @baseblocks/anydoc-spreadsheet-engine @baseblocks/anydoc-spreadsheet-viewer \
  @baseblocks/anydoc-presentation-viewer
```

```ts
import { toMarkdown, toDocument } from "@baseblocks/anydoc/node";
import { decodeTextContent, getCapabilities } from "@baseblocks/anydoc";
import { loadViewerAdapter } from "@baseblocks/anydoc/adapters";

const markdown = await toMarkdown("report.docx");
const contentModel = await toDocument(bytes);
const plainText = decodeTextContent(textBytes, "text");
const viewer = await loadViewerAdapter("docx");
```

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

For hosts that already own durable scheduling and transactions, call
`executeIngestion()` from `@baseblocks/anydoc/ingestion`. It executes one
verified, bounded attempt with content/index sinks, cancellation, and an optional
absolute source-read `deadline`, but adds no
queue, lease, retry, or persistence abstraction. The complete durable runtime
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
