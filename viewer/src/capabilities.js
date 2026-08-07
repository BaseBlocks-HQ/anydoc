const formats = ["text", "markdown", "pdf", "docx", "xlsx", "csv", "pptx", "unsupported"];

export const capabilityMatrix = Object.freeze({
  text: { view: true, native: true, search: true, note: "Bounded plain-text rendering; HTML is never interpreted." },
  markdown: { view: true, native: true, search: true, note: "Sanitized Markdown only; raw HTML and remote images are blocked." },
  pdf: { view: true, native: true, search: true, note: "PDF.js worker rendering; scripts, forms, launches, and attachments are blocked." },
  docx: { view: true, native: true, search: true, note: "DOCX renderer adapter; macros, OLE, and external relationships are blocked." },
  xlsx: { view: true, native: true, search: true, note: "Virtualized spreadsheet surface; formulas are inert and external references are blocked." },
  csv: { view: true, native: true, search: true, note: "Virtualized inert spreadsheet surface; formula-like values remain text." },
  pptx: { view: true, native: true, search: true, note: "Lazy static slide renderer; external media, scripts, and embedded objects are blocked." },
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
