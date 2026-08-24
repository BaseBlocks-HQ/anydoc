import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { defaultDocumentLimits, type DocumentLimits } from "@baseblocks/anydoc-contracts";
import { ViewerError } from "./errors.js";

function unsafePath(name: string): boolean {
  return name.startsWith("/") || name.startsWith("\\") || name.split(/[\\/]/u).includes("..");
}

function removeExternalRelationships(data: Uint8Array): Uint8Array {
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(data);
  const sanitized = xml.replace(/<Relationship\b[^>]*\bTargetMode\s*=\s*(["'])External\1[^>]*\/?\s*>/giu, "");
  return new TextEncoder().encode(sanitized);
}

export async function sanitizeDocxArchive(
  bytes: Uint8Array,
  limits: DocumentLimits = defaultDocumentLimits,
): Promise<ArrayBuffer> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const output = new Uint8ArrayWriter();
  (output as Uint8ArrayWriter & { maxSize: number }).maxSize = limits.archive.maxUncompressedBytes;
  const writer = new ZipWriter(output);
  let total = 0;
  const names = new Set<string>();
  try {
    const entries = await reader.getEntries();
    if (entries.length > limits.archive.maxEntries) {
      throw new ViewerError("DOCX archive contains too many entries.", { code: "resource-limit", format: "docx" });
    }
    for (const entry of entries) {
      if (entry.directory) continue;
      if (unsafePath(entry.filename) || names.has(entry.filename)) {
        throw new ViewerError("DOCX archive contains an unsafe or duplicate path.", { code: "malformed", format: "docx" });
      }
      names.add(entry.filename);
      if (entry.encrypted) {
        throw new ViewerError("Encrypted DOCX archives are not supported.", { code: "malformed", format: "docx" });
      }
      if (entry.uncompressedSize > limits.archive.maxPartBytes) {
        throw new ViewerError("DOCX archive part exceeds the resource limit.", { code: "resource-limit", format: "docx" });
      }
      total += entry.uncompressedSize;
      if (total > limits.archive.maxUncompressedBytes) {
        throw new ViewerError("DOCX archive exceeds the expanded-size limit.", { code: "resource-limit", format: "docx" });
      }
      const partWriter = new Uint8ArrayWriter();
      (partWriter as Uint8ArrayWriter & { maxSize: number }).maxSize = limits.archive.maxPartBytes;
      const extracted = await entry.getData?.(partWriter);
      if (!extracted) throw new ViewerError("DOCX archive part could not be read.", { code: "malformed", format: "docx" });
      const data = entry.filename.toLowerCase().endsWith(".rels") ? removeExternalRelationships(extracted) : extracted;
      await writer.add(entry.filename, new Uint8ArrayReader(data), { level: 6 });
    }
    if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
      throw new ViewerError("DOCX archive is missing required parts.", { code: "malformed", format: "docx" });
    }
    return (await writer.close()).buffer;
  } catch (cause) {
    await writer.close().catch(() => undefined);
    if (cause instanceof ViewerError) throw cause;
    throw new ViewerError("DOCX archive failed security validation.", { cause, code: "malformed", format: "docx" });
  } finally {
    await reader.close();
  }
}
