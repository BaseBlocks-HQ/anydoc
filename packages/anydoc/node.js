import {
  formatFromBytes,
  formatFromExtension,
  formatFromPath,
  toDocument,
  toMarkdown,
  toMarkdownBytes,
} from "@firecrawl/anydoc";
import { bytesSource } from "./src/sources.js";
import { fileSource } from "./src/node-sources.js";
import { ingestDocumentSource } from "./src/simple-ingestion.js";
import { DocumentPlatformError } from "@baseblocks/anydoc-contracts";

export {
  formatFromBytes,
  formatFromExtension,
  formatFromPath,
  toDocument,
  toMarkdown,
  toMarkdownBytes,
};

function isDocumentSource(input) {
  return input && typeof input === "object" && typeof input.open === "function";
}

async function toSource(input, options) {
  if (isDocumentSource(input)) return input;
  if (input instanceof URL && input.protocol !== "file:") {
    throw new DocumentPlatformError(
      "Node ingest accepts file URLs only. Use webSource() with an explicit SSRF policy for remote URLs.",
      { code: "invalid-source" },
    );
  }
  if (typeof input === "string" || input instanceof URL) return fileSource(input, { filename: options.filename });
  if (input instanceof Blob) {
    return bytesSource(new Uint8Array(await input.arrayBuffer()), {
      contentType: options.contentType ?? (input.type || undefined),
      filename: options.filename ?? ("name" in input ? input.name : undefined),
    });
  }
  return bytesSource(input, { contentType: options.contentType, filename: options.filename });
}

/** Safely convert a path, file/blob, bytes, or explicit DocumentSource to clean Markdown. */
export async function ingest(input, options = {}) {
  const source = await toSource(input, options);
  return ingestDocumentSource(source, options, {
    formatFromBytes,
    formatFromExtension,
    formatFromPath,
    toDocument,
    toMarkdownBytes,
  });
}
