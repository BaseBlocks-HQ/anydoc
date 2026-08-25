export type DocumentErrorCode = "aborted" | "deadline-exceeded" | "fetch-failed" | "integrity-failed" | "invalid-persistence" | "invalid-source" | "invalid-text" | "job-conflict" | "lease-lost" | "malformed" | "output-too-large" | "processing-failed" | "render-failed" | "resource-limit" | "search-failed" | "sink-failed" | "source-changed" | "too-large" | "too-many-cells" | "too-many-pages" | "too-many-slides" | "unsupported-runtime" | "worker-failed";
export interface DocumentPlatformErrorDetails { readonly code: DocumentErrorCode; readonly format?: string; readonly cause?: unknown; readonly status?: number; readonly retryable?: boolean }
export declare class DocumentPlatformError extends Error { readonly code: DocumentErrorCode; readonly format?: string; readonly status?: number; readonly retryable: boolean; constructor(message: string, details: DocumentPlatformErrorDetails); toJSON(): { name: string; code: DocumentErrorCode; message: string; format?: string; status?: number; retryable: boolean } }
export interface DocumentLimits { readonly maxBytes: number; readonly maxTextBytes: number; readonly maxPdfPages: number; readonly maxSpreadsheetCells: number; readonly maxSlides: number; readonly archive: { readonly maxEntries: number; readonly maxPartBytes: number; readonly maxUncompressedBytes: number } }
export declare const defaultDocumentLimits: DocumentLimits;
export declare function isSafeExternalUrl(value: string): boolean;
export declare function limitForFormat(format: string, limits?: DocumentLimits): number;
export declare function assertWithinByteLimit(size: number, format: string, limits?: DocumentLimits): void;
export declare function assertCountWithinLimit(count: number, maximum: number, kind: "PDF page" | "slide" | "spreadsheet cell", format: string): void;
