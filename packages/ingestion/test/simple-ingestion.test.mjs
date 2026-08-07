import assert from "node:assert/strict";
import test from "node:test";
import { ingest } from "../node.js";
import { ingestDocumentSource } from "../src/simple-ingestion.js";
import { bytesSource } from "../src/sources.js";

test("ingest turns bytes into a normalized Markdown result", async () => {
  const result = await ingest(new TextEncoder().encode("Hello, AnyDoc."), {
    filename: "notes.txt",
  });

  assert.equal(result.format, "text");
  assert.equal(result.markdown, "Hello, AnyDoc.");
  assert.deepEqual(result.content, {
    format: "text",
    markdown: "Hello, AnyDoc.",
    text: "Hello, AnyDoc.",
  });
  assert.equal(result.source.byteLength, 14);
  assert.match(result.source.sha256, /^[a-f\d]{64}$/);
});

test("ingest bounds parser output on the easy path", async () => {
  await assert.rejects(
    ingestDocumentSource(bytesSource(new Uint8Array([1])), {
      format: "docx",
      maxTextBytes: 3,
    }, {
      toDocument() { return {}; },
      toMarkdownBytes() { return "four"; },
    }),
    { code: "output-too-large", retryable: false },
  );
});

test("ingest keeps the safe byte ceiling on the easy path", async () => {
  await assert.rejects(
    ingest(new Uint8Array(5), { format: "text", maxBytes: 4 }),
    { code: "too-large" },
  );
});
