import type { IngestionJob, IngestionJobStore, PersistentIngestionArtifact } from "./ingestion.js";
import type { PersistenceValue } from "./persistence.js";
export interface MemoryJobStore extends IngestionJobStore { list(): Promise<IngestionJob[]> }
export interface MemorySink {
  write(input: { readonly artifact: PersistentIngestionArtifact; readonly content?: PersistenceValue; readonly idempotencyKey: string; readonly job?: IngestionJob; readonly signal: AbortSignal }): Promise<PersistenceValue>;
  get(idempotencyKey: string): unknown; size(): number;
}
export declare function createMemoryJobStore(options?: { readonly makeToken?: () => string }): MemoryJobStore;
export declare function createMemoryContentSink(): MemorySink;
export declare function createMemoryIndexSink(): MemorySink;
