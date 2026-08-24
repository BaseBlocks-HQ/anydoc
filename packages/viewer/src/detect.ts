import type { ViewerFormat } from "./controls.js";

const EXTENSIONS: Record<string, ViewerFormat> = {
  csv: "csv",
  docx: "docx",
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  pdf: "pdf",
  pptx: "pptx",
  text: "text",
  txt: "text",
  xlsx: "xlsx",
};

const CONTENT_TYPES: Record<string, ViewerFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/csv": "csv",
  "text/markdown": "markdown",
  "text/plain": "text",
  "text/x-markdown": "markdown",
};

export function sourceFilename(source: unknown): string | undefined {
  if (typeof File !== "undefined" && source instanceof File) return source.name;
  const value = typeof source === "object" && source !== null && "url" in source ? (source as { url: unknown }).url : source;
  if (typeof value !== "string" && !(value instanceof URL)) return undefined;
  try {
    const path = value instanceof URL ? value.pathname : new URL(value, globalThis.location?.href).pathname;
    return decodeURIComponent(path.split("/").at(-1) ?? "");
  } catch {
    return typeof value === "string" ? value.split(/[\\/]/).at(-1) : undefined;
  }
}

function sourceContentType(source: unknown): string | undefined {
  return typeof Blob !== "undefined" && source instanceof Blob && source.type ? source.type : undefined;
}

export function detectViewerFormat(input: {
  readonly source: unknown;
  readonly format?: ViewerFormat;
  readonly filename?: string;
  readonly contentType?: string;
}): ViewerFormat | undefined {
  if (input.format) return input.format;
  const contentType = (input.contentType ?? sourceContentType(input.source))?.split(";", 1)[0]?.toLowerCase();
  if (contentType && CONTENT_TYPES[contentType]) return CONTENT_TYPES[contentType];
  const filename = input.filename ?? sourceFilename(input.source);
  const extension = filename?.split(".").at(-1)?.toLowerCase();
  if (extension && EXTENSIONS[extension]) return EXTENSIONS[extension];
  return undefined;
}

function littleEndian32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] ?? 0) | (bytes[offset + 1] ?? 0) << 8 | (bytes[offset + 2] ?? 0) << 16 | (bytes[offset + 3] ?? 0) << 24) >>> 0;
}

/** Inspect authoritative PDF/OOXML signatures without parsing in render. */
export async function detectViewerFormatFromBytes(bytes: Uint8Array): Promise<ViewerFormat | undefined> {
  if (bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "pdf";
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return undefined;
  const floor = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (littleEndian32(bytes, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) return undefined;
  const size = littleEndian32(bytes, eocd + 12);
  const start = littleEndian32(bytes, eocd + 16);
  if (start > bytes.byteLength || size > bytes.byteLength - start) return undefined;
  const ceiling = Math.min(start + size, start + 2 * 1024 * 1024);
  const decoder = new TextDecoder();
  let offset = start;
  for (let entries = 0; offset + 46 <= ceiling && entries < 20_000; entries += 1) {
    if (littleEndian32(bytes, offset) !== 0x02014b50) break;
    const nameLength = (bytes[offset + 28] ?? 0) | (bytes[offset + 29] ?? 0) << 8;
    const extraLength = (bytes[offset + 30] ?? 0) | (bytes[offset + 31] ?? 0) << 8;
    const commentLength = (bytes[offset + 32] ?? 0) | (bytes[offset + 33] ?? 0) << 8;
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > ceiling) break;
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith("word/")) return "docx";
    if (name.startsWith("ppt/")) return "pptx";
    if (name.startsWith("xl/")) return "xlsx";
    offset = end;
    if (entries > 0 && entries % 500 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return undefined;
}
