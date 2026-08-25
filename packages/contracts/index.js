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
    this.retryable = details.retryable ?? false;
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
      retryable: this.retryable,
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
