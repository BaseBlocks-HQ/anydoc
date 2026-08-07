import type { IngestionJob, IngestionJobStore, IngestionSink } from "./ingestion";
export interface MemoryJobStore extends IngestionJobStore { list(): Promise<IngestionJob[]> }
export interface MemorySink extends IngestionSink { get(idempotencyKey: string): unknown; size(): number }
export declare function createMemoryJobStore(options?: { readonly makeToken?: () => string }): MemoryJobStore;
export declare function createMemoryContentSink(): MemorySink;
export declare function createMemoryIndexSink(): MemorySink;
