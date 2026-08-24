import init, {
  formatFromBytes,
  formatFromExtension,
  toMarkdownBytes,
} from "@firecrawl/anydoc-wasm";
import {
  assertWithinByteLimit,
  defaultDocumentLimits,
  DocumentPlatformError,
} from "@baseblocks/anydoc-contracts";

export interface PlaygroundIngestionResult {
  readonly format: string;
  readonly markdown: string;
}

export interface PlaygroundIngestOptions {
  readonly contentType?: string;
  readonly filename?: string;
  readonly format?: string;
  readonly signal?: AbortSignal;
}

let runtime: Promise<unknown> | undefined;

function loadRuntime(): Promise<unknown> {
  runtime ??= init();
  return runtime;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DocumentPlatformError("The document read was aborted.", {
      code: "aborted",
      cause: signal.reason,
    });
  }
}

function normalizeFormat(value: string | undefined | null): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).toLowerCase().replace(/^\./, "");
}

function formatFromFilename(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const extension = (
    filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : filename
  ).toLowerCase();
  if (extension === ".md" || extension === ".mdown" || extension === ".markdown") return "markdown";
  if (extension === ".txt" || extension === ".text") return "text";
  return normalizeFormat(formatFromExtension(extension)) ?? undefined;
}

function formatFromContentType(contentType: string | undefined): string | undefined {
  const type = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === "text/markdown" || type === "text/x-markdown") return "markdown";
  if (type === "text/plain") return "text";
  if (type === "text/csv") return "csv";
  return undefined;
}

const TEXT_FORMATS = new Set(["markdown", "text"]);

/** Convert a local file to Markdown entirely in the browser via WebAssembly. */
export async function ingest(
  file: File,
  options: PlaygroundIngestOptions = {},
): Promise<PlaygroundIngestionResult> {
  throwIfAborted(options.signal);
  await loadRuntime();
  throwIfAborted(options.signal);

  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(options.signal);

  const hintedFormat =
    normalizeFormat(options.format) ??
    formatFromFilename(options.filename ?? file.name) ??
    formatFromContentType(options.contentType ?? file.type);

  // Input bound: the same per-format ceiling the platform applies.
  assertWithinByteLimit(bytes.byteLength, hintedFormat ?? "");
  const skipSignatureDetection =
    TEXT_FORMATS.has(hintedFormat ?? "") || hintedFormat === "csv";
  const detectedFormat = skipSignatureDetection
    ? undefined
    : normalizeFormat(formatFromBytes(bytes));
  const format =
    detectedFormat ??
    hintedFormat ??
    formatFromFilename(file.name) ??
    formatFromContentType(file.type);
  if (!format) {
    throw new DocumentPlatformError(
      "The document format could not be detected. Pass format for signature-less input such as CSV or plain text.",
      { code: "invalid-source" },
    );
  }

  let markdown: string;
  if (TEXT_FORMATS.has(format)) {
    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (cause) {
      throw new DocumentPlatformError("The document is not valid UTF-8 text.", {
        cause,
        code: "invalid-text",
        format,
      });
    }
  } else {
    // Text passthrough formats never reach this branch, so `format` is always
    // one of the native parser formats here.
    markdown = toMarkdownBytes(bytes, format as Parameters<typeof toMarkdownBytes>[1]);
  }
  throwIfAborted(options.signal);

  // Output bound: extracted Markdown stays within the shared text ceiling.
  const maxTextBytes = defaultDocumentLimits.maxTextBytes;
  if (new TextEncoder().encode(markdown).byteLength > maxTextBytes) {
    throw new DocumentPlatformError(
      `Extracted Markdown exceeds the ${maxTextBytes.toLocaleString()} byte limit.`,
      { code: "output-too-large", retryable: false },
    );
  }
  return { format, markdown };
}
