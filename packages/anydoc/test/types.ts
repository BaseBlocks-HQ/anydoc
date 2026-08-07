import { getCapabilities } from "@baseblocks/anydoc";
import { createIngestionRuntime, type IngestionArtifact } from "@baseblocks/anydoc/ingestion";
import { createMemoryContentSink, createMemoryJobStore } from "@baseblocks/anydoc/memory";
import { bytesSource, readSource, webSource } from "@baseblocks/anydoc/sources";
import { fileSource } from "@baseblocks/anydoc/sources/node";

const jobs = createMemoryJobStore();
const contentSink = createMemoryContentSink();
void getCapabilities("docx");
const runtime = createIngestionRuntime<{ readonly storageKey: string }, { readonly tenant: string }>({
  jobs,
  contentSink,
  resolveSource: ({ storageKey }) => storageKey.startsWith("/") ? fileSource(storageKey) : bytesSource(new Uint8Array()),
  process: ({ bytes, format, metadata }): IngestionArtifact => ({ content: { bytes: bytes.byteLength, tenant: metadata?.tenant }, format }),
});

void runtime.enqueue({ idempotencyKey: "tenant:doc:v1", source: { storageKey: "/tmp/doc" }, format: "docx", metadata: { tenant: "tenant" } });
void readSource(webSource("https://example.test/document", { allowUrl: (url) => url.startsWith("https://example.test/") }), {
  expectedSha256: "0".repeat(64),
  maxBytes: 1024,
});
