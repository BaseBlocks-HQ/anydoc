import assert from "node:assert/strict";
import test from "node:test";
import { DocumentPlatformError, assertCountWithinLimit, getCapabilities, listViewerFormats } from "../index.js";

test("capabilities distinguish ingestion from native viewing", () => {
  assert.equal(getCapabilities("doc").ingestion, "native");
  assert.equal(getCapabilities("doc").viewing, "none");
  assert.equal(getCapabilities("xlsb").ingestion, "native");
  assert.ok(listViewerFormats().includes("pdf"));
});

test("resource errors are structured", () => {
  assert.throws(() => assertCountWithinLimit(501, 500, "PDF page", "pdf"), (error) => error instanceof DocumentPlatformError && error.code === "too-many-pages");
});
