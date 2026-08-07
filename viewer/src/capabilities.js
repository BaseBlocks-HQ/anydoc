const formats = ["text", "markdown", "pdf", "docx", "xlsx", "csv", "pptx", "unsupported"];

export const capabilityMatrix = Object.freeze({
  text: { view: true, native: true, search: true, note: "Bounded plain-text rendering; HTML is never interpreted." },
  markdown: { view: true, native: true, search: true, note: "Sanitized Markdown only; raw HTML and remote images are blocked." },
  pdf: { view: false, native: false, search: true, note: "Contract only in this alpha; host must provide the hardened PDF.js renderer." },
  docx: { view: false, native: false, search: true, note: "Contract only in this alpha; host must provide the safe DOCX renderer." },
  xlsx: { view: false, native: false, search: true, note: "Contract only in this alpha; host must provide the worker-backed spreadsheet viewer." },
  csv: { view: false, native: false, search: true, note: "Contract only in this alpha; host must provide the inert spreadsheet surface." },
  pptx: { view: false, native: false, search: true, note: "Contract only in this alpha; host must provide the lazy static slide renderer." },
  unsupported: { view: false, native: false, search: true, note: "Semantic ingestion may still be available; native viewing is not claimed." },
});

export const postV1Formats = Object.freeze({
  doc: "Ingestion only; native viewing is not yet supported.",
  docm: "Ingestion only; macros are never executed.",
  xls: "Ingestion only; use XLSX/CSV for the initial viewer surface.",
  xlsm: "Ingestion only; macros and external references are blocked.",
  xlsb: "Ingestion only.",
  ppt: "Ingestion only.",
  pps: "Ingestion only.",
  pot: "Ingestion only.",
  pptm: "Ingestion only; macros and external media are blocked.",
  ppsx: "Ingestion only.",
  ppsm: "Ingestion only; macros are never executed.",
  odt: "Ingestion only.",
  ods: "Ingestion only.",
  odp: "Ingestion only.",
  rtf: "Ingestion only.",
  epub: "Ingestion only.",
  scannedPdf: "Ingestion only unless OCR is provided by the host application.",
});

export function getCapabilities(format) {
  return capabilityMatrix[format] ?? capabilityMatrix.unsupported;
}

export function listViewerFormats() {
  return [...formats].filter((format) => format !== "unsupported");
}
