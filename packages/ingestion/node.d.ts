export {
  formatFromBytes,
  formatFromExtension,
  formatFromPath,
  toDocument,
  toMarkdown,
  toMarkdownBytes,
} from "@firecrawl/anydoc";
export type { IngestedContent, IngestedDocument, IngestOptions } from "./src/simple-ingestion.js";
import type { DocumentSource } from "./src/sources.js";
import type { IngestedDocument, IngestOptions } from "./src/simple-ingestion.js";

export type NodeIngestionInput = string | URL | Blob | ArrayBuffer | ArrayBufferView | DocumentSource;
export declare function ingest(input: NodeIngestionInput, options?: IngestOptions): Promise<IngestedDocument>;
