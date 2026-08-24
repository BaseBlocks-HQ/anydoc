import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { sanitizeDocxArchive } from "../src/docx-archive.js";

async function fixture(path: string): Promise<Uint8Array> {
  const bytes = await readFile(resolve(process.cwd(), "../../tests/fixtures", path));
  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

describe("DOCX archive security", () => {
  it("preflights and opens a representative corpus document", async () => {
    const sanitized = await sanitizeDocxArchive(await fixture("docx/handmade-rich.docx"));
    expect(sanitized.byteLength).toBeGreaterThan(0);
  });

  it("removes every external relationship before the renderer sees the archive", async () => {
    const sanitized = await sanitizeDocxArchive(await fixture("docx/handmade-rich.docx"));
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(sanitized)));
    try {
      for (const entry of await reader.getEntries()) {
        if (entry.directory || !entry.filename.endsWith(".rels")) continue;
        const data = await entry.getData?.(new Uint8ArrayWriter());
        expect(new TextDecoder().decode(data)).not.toMatch(/TargetMode\s*=\s*(["'])External\1/iu);
      }
    } finally {
      await reader.close();
    }
  });

  it("rejects the archive-bomb corpus before docx-preview", async () => {
    await expect(sanitizeDocxArchive(await fixture("abuse/zipbomb--errors.docx"))).rejects.toMatchObject({ format: "docx" });
  });
});
