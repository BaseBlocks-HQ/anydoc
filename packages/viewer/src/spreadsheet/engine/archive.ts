import {
  BlobWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { defaultDocumentLimits } from "@baseblocks/anydoc-contracts";

export type SpreadsheetOpenLimits = Readonly<{
  maxEntries?: number;
  maxInputBytes?: number;
  maxPartBytes?: number;
  maxUncompressedBytes?: number;
  maxCells?: number;
}>;

const DEFAULT_LIMITS = {
  maxEntries: 10_000,
  maxInputBytes: 100 * 1024 * 1024,
  maxPartBytes: defaultDocumentLimits.archive.maxPartBytes,
  maxUncompressedBytes: defaultDocumentLimits.archive.maxUncompressedBytes,
  maxCells: defaultDocumentLimits.maxSpreadsheetCells,
} as const;

function unsafePath(name: string): boolean {
  return name.startsWith("/") || name.startsWith("\\") || name.split(/[\\/]/u).includes("..");
}

export class OoxmlArchive {
  readonly #parts: Map<string, Uint8Array>;

  private constructor(parts: Map<string, Uint8Array>) {
    this.#parts = parts;
  }

  static async open(bytes: Uint8Array, limits: SpreadsheetOpenLimits = {}): Promise<OoxmlArchive> {
    const resolved = { ...DEFAULT_LIMITS, ...limits };
    if (bytes.byteLength === 0) throw new Error("Workbook is empty.");
    if (bytes.byteLength > resolved.maxInputBytes)
      throw new Error("Workbook exceeds the compressed size limit.");
    const reader = new ZipReader(new Uint8ArrayReader(bytes));
    try {
      const entries = await reader.getEntries();
      if (entries.length > resolved.maxEntries)
        throw new Error("Workbook contains too many ZIP entries.");
      let total = 0;
      const parts = new Map<string, Uint8Array>();
      for (const entry of entries) {
        if (entry.directory) continue;
        if (unsafePath(entry.filename))
          throw new Error(`Workbook contains an unsafe ZIP path: ${entry.filename}`);
        if (entry.encrypted) throw new Error("Encrypted workbooks are not supported.");
        if (parts.has(entry.filename))
          throw new Error(`Workbook contains a duplicate ZIP entry: ${entry.filename}`);
        if (entry.uncompressedSize > resolved.maxPartBytes)
          throw new Error(`Workbook part exceeds the size limit: ${entry.filename}`);
        total += entry.uncompressedSize;
        if (total > resolved.maxUncompressedBytes)
          throw new Error("Workbook exceeds the expanded size limit.");
        const partWriter = new Uint8ArrayWriter();
        (partWriter as Uint8ArrayWriter & { maxSize: number }).maxSize = resolved.maxPartBytes;
        const data = await entry.getData?.(partWriter);
        if (!data) throw new Error(`Unable to read workbook part: ${entry.filename}`);
        if (data.byteLength > resolved.maxPartBytes)
          throw new Error(`Workbook part exceeds the size limit: ${entry.filename}`);
        total += data.byteLength - entry.uncompressedSize;
        if (total > resolved.maxUncompressedBytes)
          throw new Error("Workbook exceeds the expanded size limit.");
        parts.set(entry.filename, data);
      }
      return new OoxmlArchive(parts);
    } finally {
      await reader.close();
    }
  }

  cloneParts(): Map<string, Uint8Array> {
    return new Map(this.#parts);
  }

  has(name: string): boolean {
    return this.#parts.has(name);
  }

  names(): readonly string[] {
    return [...this.#parts.keys()].sort();
  }

  part(name: string): Uint8Array {
    const value = this.#parts.get(name);
    if (!value) throw new Error(`Workbook part is missing: ${name}`);
    return value;
  }

  text(name: string): string {
    return new TextDecoder().decode(this.part(name));
  }

  async export(
    overrides: ReadonlyMap<string, Uint8Array>,
    removals: ReadonlySet<string> = new Set(),
  ): Promise<Uint8Array> {
    const writer = new ZipWriter(
      new BlobWriter("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    );
    const names = new Set([...this.#parts.keys(), ...overrides.keys()]);
    for (const name of [...names].sort()) {
      if (removals.has(name)) continue;
      const data = overrides.get(name) ?? this.#parts.get(name);
      if (data) await writer.add(name, new Uint8ArrayReader(data), { level: 6 });
    }
    const blob = await writer.close();
    return new Uint8Array(await blob.arrayBuffer());
  }
}
