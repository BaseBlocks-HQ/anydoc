import type { DocumentPlatformError } from "@baseblocks/anydoc-contracts";
import type { DocumentSource, ReadSourceResult } from "./sources";

export type IngestionJobState = "queued" | "running" | "retry-scheduled" | "succeeded" | "failed";
export type IngestionPhase = "queued" | "acquire-source" | "read-source" | "process" | "store-content" | "store-index" | "complete" | "retry-scheduled" | "failed";
export interface IngestionLease { readonly owner: string; readonly token: string; readonly expiresAt: number }
export interface SerializedIngestionError { readonly name: string; readonly code: string; readonly message: string; readonly status?: number; readonly retryable: boolean }
export interface IngestionJob<SourceDescriptor = unknown, Metadata = unknown, Output = unknown> {
  readonly id: string; readonly idempotencyKey: string; readonly state: IngestionJobState; readonly phase: IngestionPhase;
  readonly revision: number; readonly attempt: number; readonly maxAttempts: number; readonly createdAt: number; readonly updatedAt: number;
  readonly nextAttemptAt?: number; readonly lease?: IngestionLease; readonly error?: SerializedIngestionError; readonly output?: Output;
  readonly input: { readonly source: SourceDescriptor; readonly format: string; readonly expectedSize?: number; readonly expectedSha256?: string; readonly maxBytes?: number; readonly metadata?: Metadata };
}
export interface IngestionJobStore<Job extends IngestionJob = IngestionJob> {
  /** Atomically enforce uniqueness of both id and idempotencyKey. */
  create(job: Job): Promise<{ readonly job: Job; readonly created: boolean }>;
  get(id: string): Promise<Job | null>;
  /** Atomically claim eligible queued/retry jobs or expired leases; increment attempt and revision. An expired final attempt becomes failed instead of remaining stranded. */
  claim(id: string, claim: { readonly workerId: string; readonly durationMs: number; readonly now: number }): Promise<Job | null>;
  /** Compare lease token and unexpired lease atomically, then extend it and increment revision. */
  renew(id: string, renewal: { readonly leaseToken: string; readonly durationMs: number; readonly now: number }): Promise<Job | null>;
  /** Compare lease token/expiry atomically. id, idempotencyKey, input, attempt, and createdAt are immutable. */
  update(id: string, update: { readonly leaseToken: string; readonly now: number; readonly patch: Partial<Job> }): Promise<Job | null>;
}
export interface RetryPolicy { readonly maxAttempts: number; nextDelay(error: DocumentPlatformError, attempt: number, random?: () => number): number | null }
export interface LeasePolicy { readonly durationMs: number; readonly heartbeatMs: number }
export interface IngestionArtifact<Content = unknown> { readonly content: Content; readonly format?: string; readonly text?: string; readonly markdown?: string; readonly metadata?: unknown }
export interface IngestionSink<Artifact extends IngestionArtifact = IngestionArtifact, Result = unknown> { write(input: { readonly artifact: Artifact; readonly content?: unknown; readonly idempotencyKey: string; readonly job: IngestionJob; readonly signal: AbortSignal }): Promise<Result> }
export interface IngestionEvent { readonly type: string; readonly jobId: string; readonly at: number; readonly [key: string]: unknown }
export interface IngestionRuntimeOptions<SourceDescriptor = unknown, Metadata = unknown, Artifact extends IngestionArtifact = IngestionArtifact> {
  readonly jobs: IngestionJobStore; readonly retry?: RetryPolicy; readonly lease?: LeasePolicy; readonly contentSink: IngestionSink<Artifact>; readonly indexSink?: IngestionSink<Artifact>;
  readonly resolveSource: (descriptor: SourceDescriptor, context: { readonly job: IngestionJob; readonly signal: AbortSignal }) => DocumentSource | Promise<DocumentSource>;
  readonly process: (input: { readonly bytes: Uint8Array; readonly format: string; readonly metadata?: Metadata; readonly source: Omit<ReadSourceResult, "bytes">; readonly signal: AbortSignal; readonly reportProgress: (progress: unknown) => void }) => Artifact | Promise<Artifact>;
  readonly observer?: ((event: IngestionEvent) => void) | { emit(event: IngestionEvent): void }; readonly clock?: () => number; readonly random?: () => number; readonly makeId?: () => string;
}
export interface EnqueueIngestion<SourceDescriptor = unknown, Metadata = unknown> { readonly id?: string; readonly idempotencyKey: string; readonly source: SourceDescriptor; readonly format: string; readonly expectedSize?: number; readonly expectedSha256?: string; readonly maxBytes?: number; readonly metadata?: Metadata }
export declare const ingestionRuntimeCapabilities: Readonly<{ durableJobs: true; idempotentSinks: true; leaseRecovery: true; nativeRenderModels: false; verifiedStreamingReads: true }>;
export declare function createRetryPolicy(options?: { readonly maxAttempts?: number; readonly baseDelayMs?: number; readonly maxDelayMs?: number; readonly jitter?: number; readonly isRetryable?: (error: DocumentPlatformError) => boolean }): RetryPolicy;
export declare function createLeasePolicy(options?: { readonly durationMs?: number; readonly heartbeatMs?: number }): LeasePolicy;
export declare function createIngestionRuntime<SourceDescriptor = unknown, Metadata = unknown, Artifact extends IngestionArtifact = IngestionArtifact>(options: IngestionRuntimeOptions<SourceDescriptor, Metadata, Artifact>): { enqueue(input: EnqueueIngestion<SourceDescriptor, Metadata>): Promise<{ readonly job: IngestionJob; readonly created: boolean }>; get(jobId: string): Promise<IngestionJob | null>; run(jobId: string, options?: { readonly workerId?: string; readonly signal?: AbortSignal }): Promise<{ readonly status: string; readonly job?: IngestionJob; readonly error?: DocumentPlatformError }> };
