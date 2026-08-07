import { ViewerError, toViewerError } from "./errors";
import type { DocumentSource, ViewerFormat } from "./types";
import { defaultDocumentLimits, limitForFormat } from "@baseblocks/anydoc-contracts";

function isUrlSource(source: DocumentSource): source is { readonly url: string | URL; readonly headers?: HeadersInit; readonly credentials?: RequestCredentials } {
  return typeof source === "object" && source !== null && "url" in source;
}

function isBytesSource(source: DocumentSource): source is { readonly data: ArrayBuffer | ArrayBufferView | Blob } {
  return typeof source === "object" && source !== null && "data" in source;
}

function assertAllowedUrl(value: string | URL, format?: ViewerFormat): URL {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value, globalThis.location?.href);
  } catch (cause) {
    throw new ViewerError("The document URL is invalid or is relative outside a browser.", {
      cause,
      code: "invalid-source",
      ...(format ? { format } : {}),
    });
  }
  if (!new Set(["http:", "https:", "blob:"]).has(url.protocol)) {
    throw new ViewerError(`The ${url.protocol} URL scheme is not allowed.`, {
      code: "invalid-source",
      ...(format ? { format } : {}),
    });
  }
  return url;
}

function checkSize(size: number, maxBytes: number, format?: ViewerFormat) {
  if (size > maxBytes) {
    throw new ViewerError(`Document exceeds the ${maxBytes.toLocaleString()} byte limit.`, {
      code: "too-large",
      ...(format ? { format } : {}),
    });
  }
}

export async function loadDocumentBytes(
  source: DocumentSource,
  options: {
    readonly format?: ViewerFormat;
    readonly maxBytes?: number;
    readonly signal?: AbortSignal;
  },
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  const maxBytes = options.maxBytes ?? (options.format ? limitForFormat(options.format, defaultDocumentLimits) : defaultDocumentLimits.maxBytes);
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new ViewerError("The document byte limit is invalid.", { code: "invalid-source", ...(options.format ? { format: options.format } : {}) });
  }
  const raw = isBytesSource(source) ? source.data : source;

  if (raw instanceof Blob) {
    checkSize(raw.size, maxBytes, options.format);
    const bytes = new Uint8Array(await raw.arrayBuffer());
    options.signal?.throwIfAborted();
    return bytes;
  }
  if (raw instanceof ArrayBuffer) {
    checkSize(raw.byteLength, maxBytes, options.format);
    return new Uint8Array(raw.slice(0));
  }
  if (ArrayBuffer.isView(raw)) {
    checkSize(raw.byteLength, maxBytes, options.format);
    return new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  }

  const request = isUrlSource(source) ? source : { url: source as string | URL };
  const url = assertAllowedUrl(request.url, options.format);
  try {
    const response = await fetch(url, {
      credentials: request.credentials ?? "same-origin",
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) {
      throw new ViewerError(`Document request failed with status ${response.status}.`, {
        code: "fetch-failed",
        ...(options.format ? { format: options.format } : {}),
        status: response.status,
      });
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize)) checkSize(declaredSize, maxBytes, options.format);
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      checkSize(buffer.byteLength, maxBytes, options.format);
      return new Uint8Array(buffer);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        options.signal?.throwIfAborted();
        size += value.byteLength;
        checkSize(size, maxBytes, options.format);
        chunks.push(value);
      }
    } catch (cause) {
      await reader.cancel(cause).catch(() => undefined);
      throw cause;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (cause) {
    throw toViewerError(cause, {
      code: "fetch-failed",
      ...(options.format ? { format: options.format } : {}),
      message: "Unable to load the document source.",
    });
  }
}

export function decodeUtf8(bytes: Uint8Array, format: "text" | "markdown"): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new ViewerError("The document is not valid UTF-8 text.", {
      code: "invalid-text",
      cause,
      format,
    });
  }
}
