import type { DocumentSource, SourceMetadata } from "./sources.js";
export declare function fileSource(path: string | URL, metadata?: Omit<SourceMetadata, "size">): DocumentSource;
