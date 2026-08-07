import { bytesSource, webSource } from "@baseblocks/anydoc-ingestion/sources";
import { ingestDocumentSource } from "@baseblocks/anydoc-ingestion/pipeline";

let runtimePromise;
export async function loadAnyDocWasm(input) {
  runtimePromise ??= import("@firecrawl/anydoc-wasm").then(async (runtime) => {
    await runtime.default(input);
    return runtime;
  });
  return runtimePromise;
}
export async function toMarkdownBytes(bytes, format, wasmInput) {
  return (await loadAnyDocWasm(wasmInput)).toMarkdownBytes(bytes, format);
}
export async function toDocument(bytes, format, wasmInput) {
  return (await loadAnyDocWasm(wasmInput)).toDocument(bytes, format);
}
function isDocumentSource(input) {
  return input && typeof input === "object" && typeof input.open === "function";
}
async function toSource(input, options) {
  if (isDocumentSource(input)) return input;
  if (typeof input === "string" || input instanceof URL) {
    if (!options.allowUrl) throw new TypeError("Browser URL ingestion requires allowUrl so remote-source policy is explicit.");
    return webSource(input, { allowUrl: options.allowUrl, contentType: options.contentType, filename: options.filename, request: options.request });
  }
  if (input instanceof Blob) {
    return bytesSource(new Uint8Array(await input.arrayBuffer()), {
      contentType: options.contentType ?? (input.type || undefined),
      filename: options.filename ?? ("name" in input ? input.name : undefined),
    });
  }
  return bytesSource(input, { contentType: options.contentType, filename: options.filename });
}
export async function ingest(input, options = {}) {
  const source = await toSource(input, options);
  const runtime = () => loadAnyDocWasm(options.wasmInput);
  return ingestDocumentSource(source, options, {
    async formatFromBytes(bytes) { return (await runtime()).formatFromBytes(bytes); },
    async formatFromExtension(extension) { return (await runtime()).formatFromExtension(extension); },
    async formatFromPath(path) { return (await runtime()).formatFromPath(path); },
    async toDocument(bytes, format) { return (await runtime()).toDocument(bytes, format); },
    async toMarkdownBytes(bytes, format) { return (await runtime()).toMarkdownBytes(bytes, format); },
  });
}
