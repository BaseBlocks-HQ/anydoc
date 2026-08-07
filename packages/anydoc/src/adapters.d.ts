export interface ViewerAdapterModules {
  text: typeof import("@baseblocks/anydoc-react-viewer");
  markdown: typeof import("@baseblocks/anydoc-react-viewer");
  pdf: typeof import("@baseblocks/anydoc-react-viewer");
  docx: typeof import("@baseblocks/anydoc-react-viewer");
  xlsx: typeof import("@baseblocks/anydoc-spreadsheet-viewer");
  csv: typeof import("@baseblocks/anydoc-spreadsheet-viewer");
  pptx: typeof import("@baseblocks/anydoc-presentation-viewer");
}
export type ViewerAdapterFormat = keyof ViewerAdapterModules;
export declare function loadViewerAdapter<Format extends ViewerAdapterFormat>(format: Format): Promise<ViewerAdapterModules[Format]>;
export declare function loadViewerAdapter(format: string): Promise<ViewerAdapterModules[ViewerAdapterFormat] | null>;
export declare function viewerAdapterFormats(): ViewerAdapterFormat[];
