import { describe, expect, it, vi } from "vitest";
import { decodeUtf8, loadDocumentBytes, ViewerError } from "../src/index";

describe("document sources", () => {
  it("copies byte-backed sources and decodes strict UTF-8", async () => {
    const input = new Uint8Array([104, 105]);
    const bytes = await loadDocumentBytes(input, { format: "text" });
    input[0] = 0;
    expect(decodeUtf8(bytes, "text")).toBe("hi");
  });

  it("rejects active URL schemes with a structured error", async () => {
    await expect(loadDocumentBytes("javascript:alert(1)", { format: "pdf" })).rejects.toMatchObject({
      code: "invalid-source",
      format: "pdf",
      name: "ViewerError",
    });
  });

  it("honors cancellation for byte-backed sources", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadDocumentBytes(new Uint8Array([1]), { format: "pdf", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("enforces declared and actual response limits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(8), {
      headers: { "content-length": "8" },
      status: 200,
    })));
    await expect(loadDocumentBytes("https://example.test/file", { format: "docx", maxBytes: 4 })).rejects.toBeInstanceOf(ViewerError);
    vi.unstubAllGlobals();
  });

  it("cancels a streamed response before buffering past the byte limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
      },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    await expect(loadDocumentBytes("https://example.test/file", { format: "pdf", maxBytes: 6 })).rejects.toMatchObject({ code: "too-large" });
    expect(cancelled).toBe(true);
    vi.unstubAllGlobals();
  });

  it("serializes stable error fields", () => {
    expect(new ViewerError("Nope", { code: "render-failed", format: "pdf", status: 500 }).toJSON()).toEqual({
      code: "render-failed",
      format: "pdf",
      message: "Nope",
      name: "ViewerError",
      retryable: false,
      status: 500,
    });
  });
});
