const loaders = {
  pdf: () => import("./adapters/pdf.js"),
  docx: () => import("./adapters/docx.js"),
  xlsx: () => import("./adapters/spreadsheet.js"),
  csv: () => import("./adapters/spreadsheet.js"),
  pptx: () => import("./adapters/pptx.js"),
};

export function loadViewerAdapter(format) {
  const loader = loaders[format];
  if (!loader) return Promise.resolve(null);
  return loader();
}

export function viewerAdapterFormats() { return Object.keys(loaders); }
