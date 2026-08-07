export * from "@baseblocks/anydoc-contracts";
export { defaultDocumentLimits as defaultViewerLimits } from "@baseblocks/anydoc-contracts";
export declare function isMacroEnabled(format: string): boolean;
export declare function createAbortScope(): { signal: AbortSignal; abort(reason?: unknown): void };
