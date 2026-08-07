import type { ReadSourceOptions, DocumentSource } from "./sources.js";

export interface SimpleIngestionOptions extends Pick<ReadSourceOptions, "deadline" | "expectedSha256" | "expectedSize" | "maxBytes" | "onProgress" | "signal"> {
  readonly calculateSha256?: boolean;
  readonly contentType?: string;
  readonly filename?: string;
  readonly format?: string;
  /** Also return AnyDoc's normalized document graph. Unsupported for PDF. */
  readonly includeDocument?: boolean;
  readonly maxDocumentBytes?: number;
  readonly maxTextBytes?: number;
}

export interface IngestedContent<Document = unknown> {
  readonly format: string;
  readonly markdown: string;
  /** Genuine plain text when the source itself is plain text. */
  readonly text?: string;
  readonly document?: Document;
}

export interface IngestedDocument<Document = unknown> {
  readonly content: IngestedContent<Document>;
  readonly format: string;
  readonly markdown: string;
  readonly source: {
    readonly byteLength: number;
    readonly contentType?: string;
    readonly etag?: string;
    readonly filename?: string;
    readonly sha256?: string;
  };
}

export interface SimpleIngestionParser<Document = unknown> {
  formatFromBytes?(bytes: Uint8Array): string | null | undefined | Promise<string | null | undefined>;
  formatFromExtension?(extension: string): string | null | undefined | Promise<string | null | undefined>;
  formatFromPath?(path: string): string | null | undefined | Promise<string | null | undefined>;
  toDocument(bytes: Uint8Array, format?: string): Document | Promise<Document>;
  toMarkdownBytes(bytes: Uint8Array, format?: string): string | Promise<string>;
}

export declare function ingestDocumentSource<Document = unknown>(
  source: DocumentSource,
  options: SimpleIngestionOptions,
  parser: SimpleIngestionParser<Document>,
): Promise<IngestedDocument<Document>>;
