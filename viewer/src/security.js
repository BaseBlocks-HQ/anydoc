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
  try {
    const url = new URL(value, "https://invalid.local");
    return !forbiddenSchemes.test(url.protocol) && ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch { return false; }
}

export function sanitizeFilename(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, "_").replace(/[\\/]/g, "_").trim().slice(0, 240) || "document";
}

export function isMacroEnabled(format) { return macroExtensions.has(format); }

export function assertWithinLimit(size, format, limits = defaultViewerLimits) {
  const max = format === "text" || format === "markdown" ? limits.maxTextBytes : limits.maxBytes;
  if (size > max) throw Object.assign(new Error(`Document exceeds ${max} byte viewer limit`), { code: "too-large" });
}

export function createAbortScope() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: () => controller.abort() };
}
