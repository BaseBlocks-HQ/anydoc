export * from "./src/capabilities.d.ts";
export * from "./src/security.d.ts";
export * from "./src/adapters.d.ts";
export interface ViewerRegistry { register(format: string, adapter: unknown): void; resolve(format: string): unknown; formats(): string[]; }
export function createViewerRegistry(options?: { adapters?: Record<string, unknown> }): ViewerRegistry;
