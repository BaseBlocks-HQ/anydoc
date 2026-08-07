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

test("errors serialize stable retryability without their cause", () => {
  const error = new DocumentPlatformError("upstream unavailable", {
    cause: new Error("secret"),
    code: "fetch-failed",
    retryable: true,
    status: 503,
  });
  assert.deepEqual(error.toJSON(), {
    name: "DocumentPlatformError",
    code: "fetch-failed",
    message: "upstream unavailable",
    format: undefined,
    status: 503,
    retryable: true,
  });
});
