export interface ViewerAdapters {
  text: typeof import("@baseblocks/anydoc-react-viewer");
  markdown: typeof import("@baseblocks/anydoc-react-viewer");
  pdf: typeof import("@baseblocks/anydoc-react-viewer");
  docx: typeof import("@baseblocks/anydoc-react-viewer");
  xlsx: typeof import("@baseblocks/anydoc-spreadsheet-viewer");
  csv: typeof import("@baseblocks/anydoc-spreadsheet-viewer");
  pptx: typeof import("@baseblocks/anydoc-presentation-viewer");
}
export function loadViewerAdapter<Format extends keyof ViewerAdapters>(format: Format): Promise<ViewerAdapters[Format]>;
