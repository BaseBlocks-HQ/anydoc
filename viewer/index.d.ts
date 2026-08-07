export * from "./src/capabilities";
export * from "./src/security";
export * from "./src/adapters";
export interface ViewerRegistry { register(format: string, adapter: unknown): void; resolve(format: string): unknown; formats(): string[]; }
export function createViewerRegistry(options?: { adapters?: Record<string, unknown> }): ViewerRegistry;
