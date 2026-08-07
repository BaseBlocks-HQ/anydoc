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
  const load = loaders[format];
  if (!load) throw new TypeError(`No native viewer adapter is registered for ${format}.`);
  return load();
}
