export * from "./src/capabilities.js";
export * from "./src/security.js";
export * from "./src/text.js";

export function createViewerRegistry({ adapters = {} } = {}) {
  const registry = new Map(Object.entries(adapters));
  return {
    register(format, adapter) { registry.set(format, adapter); },
    resolve(format) { return registry.get(format) ?? null; },
    formats() { return [...registry.keys()]; },
  };
}
