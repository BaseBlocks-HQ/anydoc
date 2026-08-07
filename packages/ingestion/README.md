# `@baseblocks/anydoc-ingestion`

Runtime-light document ingestion for Node servers, queues, workers, and local
tools. This package intentionally has no React or viewer implementation in its
dependency graph.

```bash
npm install @baseblocks/anydoc-ingestion
```

```ts
import { ingest } from "@baseblocks/anydoc-ingestion/node";

const document = await ingest("report.docx");
document.markdown;
document.source.sha256;
```

`ingest` accepts a path, file URL, `Blob`, bytes, or `DocumentSource`. Reads are
bounded and checksummed. Pass `includeDocument: true` only when the normalized
document graph is actually needed.

Custom storage and streaming sources use the public source helpers—applications
never import Firecrawl internals:

```ts
import { iterableSource } from "@baseblocks/anydoc-ingestion/sources";

const source = iterableSource(
  async ({ signal }) => storage.readChunks(storageId, { signal }),
  { filename: "report.docx", size: expectedBytes },
);
```

The lower-level durable runtime remains available through `/ingestion`,
`/ingestion/conformance`, `/memory`, `/persistence`, `/sources`, and
`/sources/node`. Hosts keep authorization, scheduling, storage credentials, and
application persistence; this package owns bounded reading, conversion,
portable artifacts, retry-safe execution contracts, and conformance tests.

For the one-install universal viewer plus browser ingestion, use
`@baseblocks/anydoc` instead.
