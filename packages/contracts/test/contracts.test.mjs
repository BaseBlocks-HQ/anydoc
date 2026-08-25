import assert from "node:assert/strict";
import test from "node:test";
import { DocumentPlatformError, assertCountWithinLimit } from "../index.js";

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
