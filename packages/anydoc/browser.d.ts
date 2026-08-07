export interface AnyDocBrowserRuntime {
  toMarkdownBytes(bytes: Uint8Array, format?: string): string;
  toDocument(bytes: Uint8Array, format?: string): unknown;
}
export function loadAnyDocWasm(input?: unknown): Promise<AnyDocBrowserRuntime>;
export function toMarkdownBytes(bytes: Uint8Array, format?: string, wasmInput?: unknown): Promise<string>;
export function toDocument(bytes: Uint8Array, format?: string, wasmInput?: unknown): Promise<unknown>;
