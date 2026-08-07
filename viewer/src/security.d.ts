export declare const defaultViewerLimits: { maxBytes: number; maxTextBytes: number; maxPdfPages: number; maxSpreadsheetCells: number; maxSlides: number };
export declare function isSafeExternalUrl(value: string): boolean;
export declare function sanitizeFilename(value: string): string;
export declare function isMacroEnabled(format: string): boolean;
export declare function assertWithinLimit(size: number, format: string, limits?: typeof defaultViewerLimits): void;
export declare function createAbortScope(): { signal: AbortSignal; abort(): void };
