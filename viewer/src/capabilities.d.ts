export type ViewerFormat = "text" | "markdown" | "pdf" | "docx" | "xlsx" | "csv" | "pptx" | "unsupported";
export declare const capabilityMatrix: Record<ViewerFormat, { view: boolean; native: boolean; search: boolean; note: string }>;
export declare const postV1Formats: Record<string, string>;
export declare function getCapabilities(format: string): { view: boolean; native: boolean; search: boolean; note: string };
export declare function listViewerFormats(): ViewerFormat[];
