import type { DocumentPlatformError } from "@baseblocks/anydoc-contracts";
import type { PersistenceValue } from "./persistence.js";
import type { DocumentSource, ReadSourceResult, SourceProgress } from "./sources.js";

export type IngestionJobState = "queued" | "running" | "retry-scheduled" | "succeeded" | "failed" | "cancelled";
export type IngestionPhase = "queued" | "acquire-source" | "read-source" | "process" | "store-content" | "store-index" | "complete" | "retry-scheduled" | "failed" | "cancelled";
export interface IngestionLease { readonly owner: string; readonly token: string; readonly expiresAt: number }
export interface SerializedIngestionError { readonly name: string; readonly code: string; readonly message: string; readonly status?: number; readonly retryable: boolean }
export interface IngestionJob<SourceDescriptor = PersistenceValue, Metadata = PersistenceValue, Output = PersistenceValue> {
  readonly id: string; readonly idempotencyKey: string; readonly state: IngestionJobState; readonly phase: IngestionPhase;
  readonly revision: number; readonly attempt: number; readonly maxAttempts: number; readonly createdAt: number; readonly updatedAt: number;
  readonly nextAttemptAt?: number; readonly lease?: IngestionLease; readonly error?: SerializedIngestionError; readonly output?: Output;
  readonly cancellation?: { readonly at: number; readonly reason?: string };
  readonly input: { readonly source: SourceDescriptor; readonly format: string; readonly expectedSize?: number; readonly expectedSha256?: string; readonly maxBytes?: number; readonly metadata?: Metadata };
}
export interface IngestionJobStore<Job extends IngestionJob = IngestionJob> {
  /** Atomically enforce uniqueness of both id and idempotencyKey. Persisted values must conform to the finite grammar exported by /persistence. */
  create(job: Job): Promise<{ readonly job: Job; readonly created: boolean }>;
  get(id: string): Promise<Job | null>;
  /** Atomically claim eligible queued/retry jobs or expired leases; increment attempt and revision. An expired final attempt becomes failed instead of remaining stranded. */
  claim(id: string, claim: { readonly workerId: string; readonly durationMs: number; readonly now: number }): Promise<Job | null>;
  /** Compare lease token and unexpired lease atomically, then extend it and increment revision. */
  renew(id: string, renewal: { readonly leaseToken: string; readonly durationMs: number; readonly now: number }): Promise<Job | null>;
  /** Atomically make queued, retrying, or running work terminal and clear its lease. Idempotently return an already-cancelled job; return null for missing or other terminal jobs. */
  cancel(id: string, cancellation: { readonly now: number; readonly reason?: string }): Promise<Job | null>;
  /** Compare lease token/expiry atomically. id, idempotencyKey, input, attempt, and createdAt are immutable. */
  update(id: string, update: { readonly leaseToken: string; readonly now: number; readonly patch: Partial<Job> }): Promise<Job | null>;
}
export interface RetryPolicy { readonly maxAttempts: number; nextDelay(error: DocumentPlatformError, attempt: number, random?: () => number): number | null }
export interface LeasePolicy { readonly durationMs: number; readonly heartbeatMs: number }
export interface ArtifactLimits { readonly maxArtifactBytes: number; readonly maxTextBytes: number; readonly maxBinaryBytes: number; readonly maxSinkResultBytes: number; readonly maxEntries: number; readonly maxDepth: number }
export interface ArtifactMeasurement { readonly totalBytes: number; readonly textBytes: number; readonly binaryBytes: number; readonly entries: number }
export interface IngestionArtifact<Content = unknown> { readonly content: Content; readonly format?: string; readonly text?: string; readonly markdown?: string; readonly metadata?: unknown }
export interface PersistentIngestionArtifact { readonly content: PersistenceValue; readonly format?: string; readonly text?: string; readonly markdown?: string; readonly metadata?: PersistenceValue }
export interface IngestionSink<Result = unknown> { write(input: { readonly artifact: PersistentIngestionArtifact; readonly content?: PersistenceValue; readonly idempotencyKey: string; readonly job: IngestionJob; readonly signal: AbortSignal }): Promise<Result> }
export interface OneShotIngestionSink<Result = unknown> { write(input: { readonly artifact: PersistentIngestionArtifact; readonly content?: PersistenceValue; readonly idempotencyKey: string; readonly signal: AbortSignal }): Promise<Result> }
export interface IngestionProcessorInput<Metadata = unknown> { readonly bytes: Uint8Array; readonly format: string; readonly metadata?: Metadata; readonly source: Omit<ReadSourceResult, "bytes">; readonly signal: AbortSignal; readonly reportProgress: (progress: unknown) => void }
export interface ExecuteIngestionOptions<SourceDescriptor = unknown, Metadata = unknown, Artifact extends IngestionArtifact = IngestionArtifact> {
  readonly source: SourceDescriptor; readonly format: string; readonly expectedSize?: number; readonly expectedSha256?: string; readonly maxBytes?: number; readonly metadata?: Metadata;
  readonly idempotencyKey: string; readonly signal?: AbortSignal; readonly artifactLimits?: Partial<ArtifactLimits>;
  readonly resolveSource: (descriptor: SourceDescriptor, context: { readonly signal: AbortSignal }) => DocumentSource | Promise<DocumentSource>;
  readonly process: (input: IngestionProcessorInput<Metadata>) => Artifact | Promise<Artifact>;
  readonly contentSink: OneShotIngestionSink; readonly indexSink?: OneShotIngestionSink;
  readonly onPhase?: (phase: "acquire-source" | "read-source" | "process" | "store-content" | "store-index", checkpoint: { readonly content?: PersistenceValue }) => void | Promise<void>;
  readonly onSourceProgress?: (progress: SourceProgress) => void; readonly onProcessorProgress?: (progress: unknown) => void;
}
export interface ExecuteIngestionResult { readonly output: { readonly content: PersistenceValue; readonly index?: PersistenceValue; readonly byteLength: number; readonly sha256?: string }; readonly source: Omit<ReadSourceResult, "bytes"> }
export interface IngestionEvent { readonly type: string; readonly jobId: string; readonly at: number; readonly [key: string]: unknown }
export interface IngestionRuntimeOptions<SourceDescriptor = unknown, Metadata = unknown, Artifact extends IngestionArtifact = IngestionArtifact> {
  readonly jobs: IngestionJobStore; readonly retry?: RetryPolicy; readonly lease?: LeasePolicy; readonly contentSink: IngestionSink; readonly indexSink?: IngestionSink;
  readonly resolveSource: (descriptor: SourceDescriptor, context: { readonly job: IngestionJob; readonly signal: AbortSignal }) => DocumentSource | Promise<DocumentSource>;
  readonly process: (input: IngestionProcessorInput<Metadata>) => Artifact | Promise<Artifact>;
  readonly artifactLimits?: Partial<ArtifactLimits>;
  readonly observer?: ((event: IngestionEvent) => void) | { emit(event: IngestionEvent): void }; readonly clock?: () => number; readonly random?: () => number; readonly makeId?: () => string;
}
export interface EnqueueIngestion<SourceDescriptor = unknown, Metadata = unknown> { readonly id?: string; readonly idempotencyKey: string; readonly source: SourceDescriptor; readonly format: string; readonly expectedSize?: number; readonly expectedSha256?: string; readonly maxBytes?: number; readonly metadata?: Metadata }
export declare const ingestionRuntimeCapabilities: Readonly<{ durableCancellation: true; durableJobs: true; idempotentSinks: true; leaseRecovery: true; nativeRenderModels: false; outputBudgets: true; portablePersistence: true; verifiedStreamingReads: true }>;
export declare function createArtifactLimits(options?: Partial<ArtifactLimits>): ArtifactLimits;
export declare function measureIngestionArtifact(artifact: unknown, options?: Partial<ArtifactLimits>): ArtifactMeasurement;
export declare function createRetryPolicy(options?: { readonly maxAttempts?: number; readonly baseDelayMs?: number; readonly maxDelayMs?: number; readonly jitter?: number; readonly isRetryable?: (error: DocumentPlatformError) => boolean }): RetryPolicy;
export declare function createLeasePolicy(options?: { readonly durationMs?: number; readonly heartbeatMs?: number }): LeasePolicy;
/** Runs one bounded ingestion attempt and leaves scheduling, persistence, leases, and retries to the host. */
export declare function executeIngestion<SourceDescriptor = unknown, Metadata = unknown, Artifact extends IngestionArtifact = IngestionArtifact>(options: ExecuteIngestionOptions<SourceDescriptor, Metadata, Artifact>): Promise<ExecuteIngestionResult>;
export declare function createIngestionRuntime<SourceDescriptor = unknown, Metadata = unknown, Artifact extends IngestionArtifact = IngestionArtifact>(options: IngestionRuntimeOptions<SourceDescriptor, Metadata, Artifact>): { cancel(jobId: string, options?: { readonly reason?: string }): Promise<{ readonly status: string; readonly job?: IngestionJob }>; enqueue(input: EnqueueIngestion<SourceDescriptor, Metadata>): Promise<{ readonly job: IngestionJob; readonly created: boolean }>; get(jobId: string): Promise<IngestionJob | null>; run(jobId: string, options?: { readonly workerId?: string; readonly signal?: AbortSignal }): Promise<{ readonly status: string; readonly job?: IngestionJob; readonly error?: DocumentPlatformError }> };
