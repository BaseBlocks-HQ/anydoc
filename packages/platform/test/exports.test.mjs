import assert from "node:assert/strict";
import test from "node:test";
import { iterableSource } from "@baseblocks/anydoc/sources";
import { ingest } from "@baseblocks/anydoc/browser";

test("umbrella preserves the ingestion source API", () => {
  assert.equal(typeof iterableSource, "function");
});

test("browser text ingestion stays usable without loading WASM", async () => {
  const document = await ingest(new TextEncoder().encode("hello"), { format: "text" });
  assert.equal(document.markdown, "hello");
});
