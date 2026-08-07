export interface AnyDocBrowserRuntime {
  formatFromBytes(bytes: Uint8Array): string | null;
  formatFromExtension(extension: string): string | null;
  formatFromPath(path: string): string | null;
  toMarkdownBytes(bytes: Uint8Array, format?: string): string;
  toDocument(bytes: Uint8Array, format?: string): unknown;
}
export function loadAnyDocWasm(input?: unknown): Promise<AnyDocBrowserRuntime>;
export function toMarkdownBytes(bytes: Uint8Array, format?: string, wasmInput?: unknown): Promise<string>;
export function toDocument(bytes: Uint8Array, format?: string, wasmInput?: unknown): Promise<unknown>;
export type { IngestedContent, IngestedDocument, IngestOptions } from "@baseblocks/anydoc-ingestion/pipeline";
import type { DocumentSource } from "@baseblocks/anydoc-ingestion/sources";
import type { IngestedDocument, IngestOptions } from "@baseblocks/anydoc-ingestion/pipeline";
export interface BrowserIngestionOptions extends IngestOptions {
  readonly allowUrl?: (url: string) => boolean | Promise<boolean>;
  readonly request?: Omit<RequestInit, "body" | "method" | "redirect" | "signal">;
  readonly wasmInput?: unknown;
}
export type BrowserIngestionInput = string | URL | Blob | ArrayBuffer | ArrayBufferView | DocumentSource;
export function ingest(input: BrowserIngestionInput, options?: BrowserIngestionOptions): Promise<IngestedDocument>;
