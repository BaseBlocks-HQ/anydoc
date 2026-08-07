const forbiddenSchemes = /^(?:javascript|vbscript|data|file):/i;
const macroExtensions = new Set(["docm", "xlsm", "pptm", "ppsm"]);

export const defaultViewerLimits = Object.freeze({
  maxBytes: 100 * 1024 * 1024,
  maxTextBytes: 10 * 1024 * 1024,
  maxPdfPages: 500,
  maxSpreadsheetCells: 100_000,
  maxSlides: 200,
});

export function isSafeExternalUrl(value) {
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return false;
  try {
    const url = new URL(value, "https://invalid.local");
    return !forbiddenSchemes.test(url.protocol) && ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch { return false; }
}

export function sanitizeFilename(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "_").replace(/[\\/]/g, "_").trim().slice(0, 240) || "document";
}

export function isMacroEnabled(format) { return macroExtensions.has(format.toLowerCase().replace(/^\./, "")); }

export function assertWithinLimit(size, format, limits = defaultViewerLimits) {
  if (!Number.isFinite(size) || size < 0) throw Object.assign(new Error("Invalid document size"), { code: "too-large" });
  const max = format === "text" || format === "markdown" ? limits.maxTextBytes : limits.maxBytes;
  if (size > max) throw Object.assign(new Error(`Document exceeds ${max} byte viewer limit`), { code: "too-large" });
}

export function assertPageCountWithinLimit(count, limits = defaultViewerLimits) {
  if (!Number.isInteger(count) || count < 0 || count > limits.maxPdfPages) throw Object.assign(new Error("PDF page limit exceeded"), { code: "too-many-pages" });
}

export function assertSpreadsheetCellsWithinLimit(count, limits = defaultViewerLimits) {
  if (!Number.isInteger(count) || count < 0 || count > limits.maxSpreadsheetCells) throw Object.assign(new Error("Spreadsheet cell limit exceeded"), { code: "too-many-rows" });
}

export function assertSlideCountWithinLimit(count, limits = defaultViewerLimits) {
  if (!Number.isInteger(count) || count < 0 || count > limits.maxSlides) throw Object.assign(new Error("Slide limit exceeded"), { code: "too-many-slides" });
}

export function createAbortScope() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: () => controller.abort() };
}
