import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

describe("PDF corpus", () => {
  it("opens representative bytes with active features disabled and exposes selectable text", async () => {
    const file = await readFile(resolve(process.cwd(), "../../tests/fixtures/pdf/text.pdf"));
    const task = getDocument({
      data: new Uint8Array(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)),
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
    });
    const document = await task.promise;
    try {
      expect(document.numPages).toBeGreaterThan(0);
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      expect(content.items.some((item) => "str" in item && item.str.trim().length > 0)).toBe(true);
      page.cleanup();
    } finally {
      await document.destroy();
    }
  });
});
