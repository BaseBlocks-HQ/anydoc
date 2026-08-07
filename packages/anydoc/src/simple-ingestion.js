import { DocumentPlatformError, defaultDocumentLimits } from "@baseblocks/anydoc-contracts";
import { decodeTextContent } from "./text.js";
import { measurePersistenceValue } from "./persistence.js";
import { readSource } from "./sources.js";

const TEXT_FORMATS = new Set(["markdown", "text"]);

function normalizeFormat(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value).toLowerCase().replace(/^\./, "");
}

async function formatFromFilename(filename, parser) {
  if (!filename) return undefined;
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : filename;
  if ([".md", ".mdown", ".markdown"].includes(extension.toLowerCase())) return "markdown";
  if ([".txt", ".text"].includes(extension.toLowerCase())) return "text";
  return normalizeFormat(await parser.formatFromPath?.(filename) ?? await parser.formatFromExtension?.(extension));
}

function formatFromContentType(contentType) {
  const type = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === "text/markdown" || type === "text/x-markdown") return "markdown";
  if (type === "text/plain") return "text";
  if (type === "text/csv") return "csv";
  return undefined;
}

/**
 * Bounded, one-shot ingestion for request handlers, local tools, and hosts
 * that already own their execution lifecycle. This intentionally does not
 * claim durable scheduling or persistence.
 */
export async function ingestDocumentSource(source, options, parser) {
  const hintedFormat = normalizeFormat(options.format)
    ?? await formatFromFilename(options.filename, parser)
    ?? formatFromContentType(options.contentType);
  const maxTextBytes = options.maxTextBytes ?? defaultDocumentLimits.maxTextBytes;
  const read = await readSource(source, {
    calculateSha256: options.calculateSha256 ?? true,
    deadline: options.deadline,
    expectedSha256: options.expectedSha256,
    expectedSize: options.expectedSize,
    maxBytes: options.maxBytes ?? (TEXT_FORMATS.has(hintedFormat) ? maxTextBytes : defaultDocumentLimits.maxBytes),
    onProgress: options.onProgress,
    signal: options.signal,
  });

  const skipSignatureDetection = TEXT_FORMATS.has(hintedFormat) || hintedFormat === "csv";
  const detectedFormat = skipSignatureDetection
    ? undefined
    : normalizeFormat(await parser.formatFromBytes?.(read.bytes));
  const format = detectedFormat
    ?? hintedFormat
    ?? await formatFromFilename(read.filename, parser)
    ?? formatFromContentType(options.contentType ?? read.contentType);

  if (!format) {
    throw new DocumentPlatformError(
      "The document format could not be detected. Pass format for signature-less input such as CSV or plain text.",
      { code: "invalid-source" },
    );
  }

  let markdown;
  let document;
  if (TEXT_FORMATS.has(format)) {
    const decoded = decodeTextContent(read.bytes, format);
    markdown = decoded.markdown ?? decoded.text;
  } else {
    try {
      markdown = await parser.toMarkdownBytes(read.bytes, format);
      if (options.includeDocument && format !== "pdf") {
        document = await parser.toDocument(read.bytes, format);
      }
    } catch (cause) {
      throw new DocumentPlatformError(cause instanceof Error ? cause.message : "Document conversion failed.", {
        cause,
        code: "processing-failed",
        retryable: false,
      });
    }
  }
  if (typeof markdown !== "string") {
    throw new DocumentPlatformError("The parser returned no Markdown.", { code: "processing-failed", retryable: false });
  }
  if (new TextEncoder().encode(markdown).byteLength > maxTextBytes) {
    throw new DocumentPlatformError(`Extracted Markdown exceeds the ${maxTextBytes.toLocaleString()} byte limit.`, { code: "output-too-large", retryable: false });
  }
  if (document !== undefined) {
    measurePersistenceValue(document, {
      code: "processing-failed",
      maxBinaryBytes: options.maxDocumentBytes ?? defaultDocumentLimits.maxBytes,
      maxBytes: options.maxDocumentBytes ?? 128 * 1024 * 1024,
      maxDepth: 128,
      maxEntries: 500_000,
      maxTextBytes,
      name: "The normalized document",
    });
  }

  const content = Object.freeze({
    format,
    markdown,
    ...(format === "text" ? { text: markdown } : {}),
    ...(document === undefined ? {} : { document }),
  });
  return Object.freeze({
    content,
    format,
    markdown,
    source: Object.freeze({
      byteLength: read.byteLength,
      ...(read.contentType === undefined ? {} : { contentType: read.contentType }),
      ...(read.etag === undefined ? {} : { etag: read.etag }),
      ...(read.filename === undefined ? {} : { filename: read.filename }),
      ...(read.sha256 === undefined ? {} : { sha256: read.sha256 }),
    }),
  });
}
