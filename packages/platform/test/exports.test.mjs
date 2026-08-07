import assert from "node:assert/strict";
import test from "node:test";
import { iterableSource } from "@baseblocks/anydoc/sources";
import { ingest } from "@baseblocks/anydoc/browser";
import { loadViewerAdapter } from "@baseblocks/anydoc/adapters";

test("umbrella preserves the ingestion source API", () => {
  assert.equal(typeof iterableSource, "function");
});

test("browser text ingestion stays usable without loading WASM", async () => {
  const document = await ingest(new TextEncoder().encode("hello"), { format: "text" });
  assert.equal(document.markdown, "hello");
});

test("format adapters resolve real lazy viewer packages", async () => {
  const [react, spreadsheet, presentation] = await Promise.all([
    loadViewerAdapter("pdf"),
    loadViewerAdapter("xlsx"),
    loadViewerAdapter("pptx"),
  ]);
  assert.equal(typeof react.PdfViewer, "function");
  assert.equal(typeof spreadsheet.SpreadsheetViewer, "function");
  assert.equal(typeof presentation.PresentationViewer, "function");
});
