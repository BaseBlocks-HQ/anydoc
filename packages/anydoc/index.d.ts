export * from "./src/capabilities";
export * from "./src/security";
export * from "./src/text";
export interface ViewerRegistry<Adapter = unknown> { register(format: string, adapter: Adapter): void; resolve(format: string): Adapter | null; formats(): string[]; }
export function createViewerRegistry<Adapter = unknown>(options?: { adapters?: Record<string, Adapter> }): ViewerRegistry<Adapter>;
