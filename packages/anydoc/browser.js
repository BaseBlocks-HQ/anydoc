let runtimePromise;

export async function loadAnyDocWasm(input) {
  runtimePromise ??= import("@firecrawl/anydoc-wasm").then(async (runtime) => {
    await runtime.default(input);
    return runtime;
  });
  return runtimePromise;
}

export async function toMarkdownBytes(bytes, format, wasmInput) {
  const runtime = await loadAnyDocWasm(wasmInput);
  return runtime.toMarkdownBytes(bytes, format);
}

export async function toDocument(bytes, format, wasmInput) {
  const runtime = await loadAnyDocWasm(wasmInput);
  return runtime.toDocument(bytes, format);
}
