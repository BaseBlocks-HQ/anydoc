export interface SourceOpenContext { readonly signal?: AbortSignal }
export interface OpenDocumentSource {
  readonly stream: AsyncIterable<Uint8Array | ArrayBuffer | ArrayBufferView> | ReadableStream<Uint8Array>;
  readonly size?: number;
  readonly contentType?: string;
  readonly filename?: string;
  readonly etag?: string;
  close?(): void | Promise<void>;
}
export interface DocumentSource {
  readonly id?: string;
  open(context?: SourceOpenContext): OpenDocumentSource | Promise<OpenDocumentSource>;
}
export interface SourceMetadata { readonly id?: string; readonly size?: number; readonly contentType?: string; readonly filename?: string; readonly etag?: string }
export interface SourceProgress { readonly bytesRead: number; readonly totalBytes?: number }
export interface ReadSourceOptions {
  readonly maxBytes?: number;
  readonly expectedSize?: number;
  readonly expectedSha256?: string;
  readonly calculateSha256?: boolean;
  /** Final-buffer fallback. Prefer createChecksum for large inputs. */
  readonly sha256?: (bytes: Uint8Array) => string | Promise<string>;
  readonly createChecksum?: () => IncrementalChecksum;
  readonly signal?: AbortSignal;
  /** Absolute Unix epoch deadline in milliseconds. */
  readonly deadline?: number | Date;
  readonly onProgress?: (progress: SourceProgress) => void;
}
export interface ReadSourceResult extends SourceMetadata { readonly bytes: Uint8Array; readonly byteLength: number; readonly sha256?: string }
export declare function sha256Hex(bytes: Uint8Array): Promise<string>;
export interface IncrementalChecksum { update(chunk: Uint8Array): void; digestHex(): string }
export declare function createSha256(): IncrementalChecksum;
export declare function readSource(source: DocumentSource, options?: ReadSourceOptions): Promise<ReadSourceResult>;
export declare function bytesSource(bytes: Uint8Array | ArrayBuffer | ArrayBufferView, metadata?: SourceMetadata): DocumentSource;
export declare function iterableSource(factory: (context: SourceOpenContext) => OpenDocumentSource["stream"] | Promise<OpenDocumentSource["stream"]>, metadata?: SourceMetadata): DocumentSource;
export interface WebSourceOptions extends Omit<SourceMetadata, "size"> {
  readonly fetch?: typeof fetch;
  readonly request?: Omit<RequestInit, "body" | "method" | "redirect" | "signal">;
  readonly allowUrl?: (url: string) => boolean | Promise<boolean>;
  readonly maxRedirects?: number;
  /** Forward credentials and all caller-supplied headers across origins. Unsafe by default. */
  readonly forwardCredentialsOnRedirect?: boolean;
}
export declare function webSource(url: string | URL, options?: WebSourceOptions): DocumentSource;
