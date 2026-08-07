export {
  DocumentPlatformError,
  assertCountWithinLimit,
  assertWithinByteLimit,
  defaultDocumentLimits,
  isSafeExternalUrl,
  limitForFormat,
  sanitizeFilename,
} from "@baseblocks/anydoc-contracts";
export { defaultDocumentLimits as defaultViewerLimits } from "@baseblocks/anydoc-contracts";

export function isMacroEnabled(format) {
  return new Set(["docm", "xlsm", "pptm", "ppsm"]).has(String(format).toLowerCase().replace(/^\./, ""));
}

export function createAbortScope() {
  const controller = new AbortController();
  return { signal: controller.signal, abort: (reason) => controller.abort(reason) };
}
