import { describe, expect, it } from "vitest";
import { decodeConvexIngestionFailure, encodeConvexIngestionFailure } from "../src/index.js";

describe("structured completion failures", () => {
  it("round-trips machine-readable codes and limits through Workpool's string result", () => {
    const cause = Object.assign(new Error("Document exceeds the byte budget."), {
      code: "too-large",
      retryable: false,
      maxBytes: 10,
      actualBytes: 12,
    });
    const error = `Uncaught ConvexError: ${encodeConvexIngestionFailure(cause)}`;
    expect(decodeConvexIngestionFailure({ kind: "failed", error })).toEqual({
      version: 1,
      kind: "anydoc-ingestion-failure",
      code: "too-large",
      message: "Document exceeds the byte budget.",
      retryable: false,
      limits: { actualBytes: 12, maxBytes: 10 },
    });
  });

  it("does not mistake unrelated failures for AnyDoc failures", () => {
    expect(decodeConvexIngestionFailure({ kind: "failed", error: "network unavailable" })).toBeUndefined();
  });
});
