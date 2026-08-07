export type IngestionCapability = "native" | "text-only" | "passthrough" | "none" | "unsupported";
export type ViewingCapability = "native" | "none";
export type DocumentErrorCode = "aborted" | "fetch-failed" | "invalid-source" | "invalid-text" | "malformed" | "render-failed" | "resource-limit" | "search-failed" | "too-large" | "too-many-cells" | "too-many-pages" | "too-many-slides" | "worker-failed";
export interface DocumentPlatformErrorDetails { readonly code: DocumentErrorCode; readonly format?: string; readonly cause?: unknown; readonly status?: number }
export declare class DocumentPlatformError extends Error { readonly code: DocumentErrorCode; readonly format?: string; readonly status?: number; constructor(message: string, details: DocumentPlatformErrorDetails); toJSON(): { name: string; code: DocumentErrorCode; message: string; format?: string; status?: number } }
export interface DocumentLimits { readonly maxBytes: number; readonly maxTextBytes: number; readonly maxPdfPages: number; readonly maxSpreadsheetCells: number; readonly maxSlides: number; readonly archive: { readonly maxEntries: number; readonly maxPartBytes: number; readonly maxUncompressedBytes: number } }
export declare const defaultDocumentLimits: DocumentLimits;
export declare function isSafeExternalUrl(value: string): boolean;
export declare function sanitizeFilename(value: string): string;
export declare function limitForFormat(format: string, limits?: DocumentLimits): number;
export declare function assertWithinByteLimit(size: number, format: string, limits?: DocumentLimits): void;
export declare function assertCountWithinLimit(count: number, maximum: number, kind: "PDF page" | "slide" | "spreadsheet cell", format: string): void;
export interface FormatCapabilities { readonly ingestion: IngestionCapability; readonly viewing: ViewingCapability; readonly search: boolean; readonly note: string }
export declare const capabilityMatrix: Readonly<Record<string, FormatCapabilities>>;
export declare function getCapabilities(format: string): FormatCapabilities;
export declare function listViewerFormats(): string[];
