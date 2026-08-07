import { createIngestionRuntime, type IngestionArtifact } from "../src/ingestion.js";
import { createMemoryContentSink, createMemoryJobStore } from "../src/memory.js";
import { bytesSource, readSource, webSource } from "../src/sources.js";
import { fileSource } from "../src/node-sources.js";

const jobs = createMemoryJobStore();
const contentSink = createMemoryContentSink();
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
