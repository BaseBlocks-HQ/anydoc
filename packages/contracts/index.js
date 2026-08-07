const forbiddenSchemes = /^(?:javascript|vbscript|data|file):/i;

export const defaultDocumentLimits = Object.freeze({
  maxBytes: 100 * 1024 * 1024,
  maxTextBytes: 10 * 1024 * 1024,
  maxPdfPages: 500,
  maxSpreadsheetCells: 100_000,
  maxSlides: 100,
  archive: Object.freeze({
    maxEntries: 10_000,
    maxPartBytes: 32 * 1024 * 1024,
    maxUncompressedBytes: 250 * 1024 * 1024,
  }),
});

export class DocumentPlatformError extends Error {
  constructor(message, details) {
    super(message, { cause: details.cause });
    this.name = "DocumentPlatformError";
    this.code = details.code;
    if (details.format !== undefined) this.format = details.format;
    if (details.status !== undefined) this.status = details.status;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      format: this.format,
      status: this.status,
    };
  }
}

export function isSafeExternalUrl(value) {
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return false;
  try {
    const url = new URL(value, "https://invalid.local");
    return !forbiddenSchemes.test(url.protocol) && ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function sanitizeFilename(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "_").replace(/[\\/]/g, "_").trim().slice(0, 240) || "document";
}

export function limitForFormat(format, limits = defaultDocumentLimits) {
  return format === "text" || format === "markdown" ? limits.maxTextBytes : limits.maxBytes;
}

export function assertWithinByteLimit(size, format, limits = defaultDocumentLimits) {
  if (!Number.isFinite(size) || size < 0) {
    throw new DocumentPlatformError("Invalid document size.", { code: "invalid-source", format });
  }
  const maximum = limitForFormat(format, limits);
  if (size > maximum) {
    throw new DocumentPlatformError(`Document exceeds the ${maximum.toLocaleString()} byte limit.`, {
      code: "too-large",
      format,
    });
  }
}

export function assertCountWithinLimit(count, maximum, kind, format) {
  if (!Number.isInteger(count) || count < 0 || count > maximum) {
    throw new DocumentPlatformError(`${kind} limit exceeded.`, {
      code: kind === "PDF page" ? "too-many-pages" : kind === "slide" ? "too-many-slides" : "too-many-cells",
      format,
    });
  }
}

const viewerCapabilities = Object.freeze({
  text: Object.freeze({ ingestion: "passthrough", viewing: "native", search: true, note: "Bounded inert UTF-8 passthrough." }),
  markdown: Object.freeze({ ingestion: "passthrough", viewing: "native", search: true, note: "Bounded UTF-8 passthrough; viewing is sanitized and blocks remote images by default." }),
  pdf: Object.freeze({ ingestion: "text-only", viewing: "native", search: true, note: "PDF.js canvas and selectable text layers with bounded virtual pages." }),
  docx: Object.freeze({ ingestion: "native", viewing: "native", search: true, note: "Bounded DOCX archive rendering with external relationships removed." }),
  xlsx: Object.freeze({ ingestion: "native", viewing: "native", search: true, note: "Worker-backed bounded spreadsheet rendering; formulas remain inert." }),
  csv: Object.freeze({ ingestion: "native", viewing: "native", search: true, note: "Bounded virtualized spreadsheet rendering; formula-like values remain text." }),
  pptx: Object.freeze({ ingestion: "native", viewing: "native", search: true, note: "Bounded lazy presentation rendering with external media blocked." }),
});

const ingestionOnly = {
  doc: "native", docm: "native", xls: "native", xlsm: "native", xlsb: "native",
  ppt: "native", pps: "native", pot: "native", pptm: "native", ppsx: "native", ppsm: "native",
  odt: "native", ods: "native", odp: "native", rtf: "native", epub: "native",
};

export const capabilityMatrix = Object.freeze({
  ...viewerCapabilities,
  ...Object.fromEntries(Object.entries(ingestionOnly).map(([format, ingestion]) => [format, Object.freeze({
    ingestion,
    viewing: "none",
    search: ingestion !== "unsupported",
    note: ingestion === "unsupported" ? "Not supported by the current ingestion or viewer runtime." : "Semantic ingestion only; native viewing is not claimed.",
  })])),
  scannedPdf: Object.freeze({ ingestion: "none", viewing: "native", search: false, note: "Visual pages only; semantic ingestion requires OCR." }),
  unsupported: Object.freeze({ ingestion: "unsupported", viewing: "none", search: false, note: "No capability is claimed." }),
});

export function getCapabilities(format) {
  return capabilityMatrix[String(format).replace(/^\./, "").toLowerCase()] ?? capabilityMatrix.unsupported;
}

export function listViewerFormats() {
  return Object.entries(capabilityMatrix).filter(([, value]) => value.viewing === "native").map(([format]) => format);
}
