const loaders = {
  text: () => import("@baseblocks/anydoc-react-viewer"),
  markdown: () => import("@baseblocks/anydoc-react-viewer"),
  pdf: () => import("@baseblocks/anydoc-react-viewer"),
  docx: () => import("@baseblocks/anydoc-react-viewer"),
  xlsx: () => import("@baseblocks/anydoc-spreadsheet-viewer"),
  csv: () => import("@baseblocks/anydoc-spreadsheet-viewer"),
  pptx: () => import("@baseblocks/anydoc-presentation-viewer"),
};

export function loadViewerAdapter(format) {
  const loader = loaders[format];
  if (!loader) return Promise.resolve(null);
  return loader();
}

export function viewerAdapterFormats() { return Object.keys(loaders); }
