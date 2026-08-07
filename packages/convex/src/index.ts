import {
  Workpool,
  type RetryBehavior,
  type OnCompleteArgs,
  type WorkId,
  type WorkpoolComponent,
  type WorkpoolOptions,
} from "@convex-dev/workpool";
import type {
  DefaultFunctionArgs,
  FunctionReference,
  FunctionVisibility,
} from "convex/server";

export type WorkpoolMutationContext = Parameters<Workpool["enqueueAction"]>[0];
export type WorkpoolQueryContext = Parameters<Workpool["status"]>[0];

export interface ConvexIngestionJob<Source = unknown, Metadata = unknown> extends DefaultFunctionArgs {
  readonly entityId: string;
  readonly sourceVersion: string;
  /** Monotonically increases whenever source or cancellation state changes. */
  readonly generation: number;
  readonly idempotencyKey: string;
  readonly source: Source;
  readonly metadata?: Metadata;
  readonly format?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly expectedSize?: number;
  readonly expectedSha256?: string;
  readonly maxBytes?: number;
  /** Maximum wall time for each Workpool attempt. A fresh deadline is created on every retry. */
  readonly attemptTimeoutMs?: number;
}

export interface ConvexIngestionReceipt {
  readonly entityId: string;
  readonly sourceVersion: string;
  readonly generation: number;
  readonly idempotencyKey: string;
  readonly workId: WorkId;
}

export interface DurableIngestionBinding<
  Args extends ConvexIngestionJob,
  MutationContext extends WorkpoolMutationContext = WorkpoolMutationContext,
  QueryContext extends WorkpoolQueryContext = WorkpoolQueryContext,
  State = unknown,
> {
  /** Atomically keep the first workId for this idempotency key/generation and return the winner. */
  bind(ctx: MutationContext, job: Args, candidate: WorkId): Promise<WorkId>;
  /** Atomically invalidate the generation before returning true. */
  cancel(ctx: MutationContext, receipt: ConvexIngestionReceipt): Promise<boolean>;
  status(ctx: QueryContext, receipt: ConvexIngestionReceipt): Promise<State>;
}

export interface ConvexIngestionQueueOptions<
  Args extends ConvexIngestionJob,
  MutationContext extends WorkpoolMutationContext = WorkpoolMutationContext,
  QueryContext extends WorkpoolQueryContext = WorkpoolQueryContext,
  BindingState = unknown,
> extends WorkpoolOptions {
  /** Retries are safe only when the result writer is idempotent by idempotencyKey. */
  readonly retry?: boolean | RetryBehavior;
  readonly binding: DurableIngestionBinding<Args, MutationContext, QueryContext, BindingState>;
  readonly onComplete?: FunctionReference<"mutation", FunctionVisibility, OnCompleteArgs>;
  readonly completionContext?: (job: Args) => unknown;
}

/**
 * Durable AnyDoc jobs backed by the official Convex Workpool component.
 * Workpool owns scheduling, concurrency, retry state, cancellation, and status.
 */
export class ConvexIngestionQueue<
  Args extends ConvexIngestionJob,
  ReturnValue = unknown,
  MutationContext extends WorkpoolMutationContext = WorkpoolMutationContext,
  QueryContext extends WorkpoolQueryContext = WorkpoolQueryContext,
  BindingState = unknown,
> {
  readonly #action: FunctionReference<"action", FunctionVisibility, Args, ReturnValue>;
  readonly #pool: Workpool;
  readonly #retry: boolean | RetryBehavior;
  readonly #binding: DurableIngestionBinding<Args, MutationContext, QueryContext, BindingState>;
  readonly #onComplete: FunctionReference<"mutation", FunctionVisibility, OnCompleteArgs> | undefined;
  readonly #completionContext: ((job: Args) => unknown) | undefined;

  constructor(
    component: WorkpoolComponent,
    action: FunctionReference<"action", FunctionVisibility, Args, ReturnValue>,
    options: ConvexIngestionQueueOptions<Args, MutationContext, QueryContext, BindingState>,
  ) {
    const { binding, completionContext, onComplete, retry = true, ...poolOptions } = options;
    this.#action = action;
    this.#retry = retry;
    this.#binding = binding;
    this.#onComplete = onComplete;
    this.#completionContext = completionContext;
    this.#pool = new Workpool(component, {
      defaultRetryBehavior: { base: 2, initialBackoffMs: 1_000, maxAttempts: 4 },
      maxParallelism: 4,
      ...poolOptions,
      retryActionsByDefault: false,
    });
  }

  async enqueue(ctx: MutationContext, job: Args): Promise<ConvexIngestionReceipt> {
    if (!job.idempotencyKey || job.idempotencyKey.length > 512) {
      throw new Error("AnyDoc Convex jobs require an idempotencyKey of at most 512 characters.");
    }
    if (!Number.isSafeInteger(job.generation) || job.generation < 0 || !job.entityId || !job.sourceVersion) {
      throw new Error("AnyDoc Convex jobs require entityId, sourceVersion, and a non-negative generation.");
    }
    if (job.attemptTimeoutMs !== undefined && (!Number.isSafeInteger(job.attemptTimeoutMs) || job.attemptTimeoutMs <= 0)) {
      throw new Error("attemptTimeoutMs must be a positive integer when provided.");
    }
    const candidate = await this.#pool.enqueueAction(ctx, this.#action, job, {
      name: "anydoc:ingest",
      retry: this.#retry,
      ...(this.#onComplete ? { onComplete: this.#onComplete, context: this.#completionContext?.(job) } : {}),
    });
    const workId = await this.#binding.bind(ctx, job, candidate);
    if (workId !== candidate) await this.#pool.cancel(ctx, candidate);
    return { entityId: job.entityId, generation: job.generation, idempotencyKey: job.idempotencyKey, sourceVersion: job.sourceVersion, workId };
  }

  async cancel(ctx: MutationContext, receipt: ConvexIngestionReceipt): Promise<boolean> {
    const cancelled = await this.#binding.cancel(ctx, receipt);
    if (cancelled) await this.#pool.cancel(ctx, receipt.workId);
    return cancelled;
  }

  async status(ctx: QueryContext, receipt: ConvexIngestionReceipt) {
    const [workpool, binding] = await Promise.all([
      this.#pool.status(ctx, receipt.workId),
      this.#binding.status(ctx, receipt),
    ]);
    return { binding, workpool };
  }
}

export type { RetryBehavior, WorkId, WorkpoolComponent } from "@convex-dev/workpool";
export { runDurableIngestionBindingConformance } from "./binding-conformance.js";
export {
  decodeConvexIngestionFailure,
  encodeConvexIngestionFailure,
  type ConvexIngestionFailure,
} from "./failure.js";
