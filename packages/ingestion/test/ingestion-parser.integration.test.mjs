import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { toDocument, toMarkdownBytes } from "../node.js";
import { createIngestionRuntime, createLeasePolicy, createRetryPolicy } from "../src/ingestion.js";
import { createMemoryJobStore } from "../src/memory.js";
import { fileSource } from "../src/node-sources.js";

const fixture = (name) => new URL(`../../../tests/fixtures/${name}`, import.meta.url);

function textFrom(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(textFrom).join(" ");
  return Object.values(value).map(textFrom).join(" ");
}

async function ingest(name, format) {
  const contentWrites = [];
  const indexWrites = [];
  let identifier = 0;
  const runtime = createIngestionRuntime({
    jobs: createMemoryJobStore({ makeToken: () => `lease-${++identifier}` }),
    resolveSource: ({ url }) => fileSource(new URL(url)),
    process: async ({ bytes, format: inputFormat }) => {
      if (inputFormat === "pdf") {
        const markdown = await toMarkdownBytes(bytes, inputFormat);
        return { content: { markdown }, markdown, text: markdown, format: inputFormat };
      }
      const content = await toDocument(bytes, inputFormat);
      return { content, text: textFrom(content.blocks), format: inputFormat };
    },
    contentSink: {
      async write(input) {
        contentWrites.push(input);
        return { documentId: `content:${input.job.id}` };
      },
    },
    indexSink: {
      async write(input) {
        indexWrites.push(input);
        return { indexedCharacters: input.artifact.text.length };
      },
    },
    makeId: () => `job-${++identifier}`,
    lease: createLeasePolicy({ durationMs: 10_000, heartbeatMs: 1_000 }),
    retry: createRetryPolicy({ maxAttempts: 1 }),
  });
  const bytes = await readFile(fixture(name));
  const { job } = await runtime.enqueue({
    idempotencyKey: `fixture:${name}`,
    source: { url: fixture(name).href },
    format,
    expectedSize: bytes.byteLength,
  });
  const result = await runtime.run(job.id, { workerId: "integration-worker" });
  assert.equal(result.status, "succeeded");
  assert.equal(contentWrites.length, 1);
  assert.equal(indexWrites.length, 1);
  assert.ok(indexWrites[0].artifact.text.length > 20);
  assert.equal(result.job.output.index.indexedCharacters, indexWrites[0].artifact.text.length);
  return indexWrites[0].artifact.text;
}

test("real DOCX and PDF parsers flow through source, runtime, content sink, and index sink", async () => {
  const docx = await ingest("docx/text.docx", "docx");
  const pdf = await ingest("pdf/text.pdf", "pdf");
  assert.match(docx, /Fixture Document/i);
  assert.match(pdf, /Fixture Document/i);
});
