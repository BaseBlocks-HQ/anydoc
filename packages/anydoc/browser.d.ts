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
export type { IngestedContent, IngestedDocument, SimpleIngestionOptions } from "./src/simple-ingestion.js";
import type { DocumentSource } from "./src/sources.js";
import type { IngestedDocument, SimpleIngestionOptions } from "./src/simple-ingestion.js";
export interface BrowserIngestionOptions extends SimpleIngestionOptions {
  readonly allowUrl?: (url: string) => boolean | Promise<boolean>;
  readonly request?: Omit<RequestInit, "body" | "method" | "redirect" | "signal">;
  readonly wasmInput?: unknown;
}
export type BrowserIngestionInput = string | URL | Blob | ArrayBuffer | ArrayBufferView | DocumentSource;
export function ingest(input: BrowserIngestionInput, options?: BrowserIngestionOptions): Promise<IngestedDocument>;
