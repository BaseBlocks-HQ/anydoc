export * from "./src/capabilities.js";
export * from "./src/security.js";
export * from "./src/text.js";
export interface ViewerRegistry<Adapter = unknown> { register(format: string, adapter: Adapter): void; resolve(format: string): Adapter | null; formats(): string[]; }
export function createViewerRegistry<Adapter = unknown>(options?: { adapters?: Record<string, Adapter> }): ViewerRegistry<Adapter>;
