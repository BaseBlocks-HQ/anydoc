import { NonRetryableError } from "@convex-dev/workpool";
import { ingest, type IngestedDocument, type IngestOptions, type NodeIngestionInput } from "@baseblocks/anydoc-ingestion/node";
import type { ConvexIngestionJob } from "./index.js";
import { encodeConvexIngestionFailure } from "./failure.js";

export { iterableSource } from "@baseblocks/anydoc-ingestion/sources";
export type {
  DocumentSource,
  OpenDocumentSource,
  SourceMetadata,
  SourceOpenContext,
} from "@baseblocks/anydoc-ingestion/sources";

export interface ConvexIngestionAttempt {
  readonly deadline: number;
  readonly signal: AbortSignal;
}

const TERMINAL_ERROR_CODES = new Set([
  "encrypted", "integrity-failed", "invalid-source", "invalid-text", "malformed",
  "missing-part", "output-too-large", "processing-failed", "resource-limit",
  "source-changed", "too-large", "too-many-cells", "too-many-pages",
  "too-many-slides", "unsupported",
]);
const DEFAULT_ATTEMPT_TIMEOUT_MS = 120_000;

export interface ConvexIngestionHandlerOptions<Context, Args extends ConvexIngestionJob> {
  /** Revalidate authorization/source generation inside the action; enqueue-time auth is insufficient. */
  readonly resolveSource: (ctx: Context, job: Args, attempt: ConvexIngestionAttempt) => NodeIngestionInput | Promise<NodeIngestionInput>;
  /** Must atomically compare entityId/sourceVersion/generation and upsert by idempotencyKey. */
  readonly writeResult: (ctx: Context, job: Args, result: IngestedDocument, attempt: ConvexIngestionAttempt) => { readonly status: "applied" | "superseded"; readonly output?: unknown } | Promise<{ readonly status: "applied" | "superseded"; readonly output?: unknown }>;
  readonly ingestion?: Omit<IngestOptions, "contentType" | "deadline" | "expectedSha256" | "expectedSize" | "filename" | "format" | "maxBytes" | "signal">;
  /** Used when the job does not specify attemptTimeoutMs. Defaults to two minutes. */
  readonly defaultAttemptTimeoutMs?: number;
  /** Test/host clock override. */
  readonly now?: () => number;
}

function validTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("attemptTimeoutMs must be a positive integer.");
  return value;
}

function createAttempt(timeout: number, now: () => number) {
  const controller = new AbortController();
  const deadline = now() + timeout;
  const failure = Object.assign(new Error("The ingestion attempt exceeded its deadline."), {
    code: "deadline-exceeded",
    retryable: true,
  });
  const timer = setTimeout(() => controller.abort(failure), timeout);
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
  });
  return {
    aborted,
    dispose: () => clearTimeout(timer),
    value: { deadline, signal: controller.signal } satisfies ConvexIngestionAttempt,
  };
}

/** Handler for a Node internalAction; import from @baseblocks/anydoc-convex/node. */
export function createConvexIngestionHandler<Context, Args extends ConvexIngestionJob>(
  options: ConvexIngestionHandlerOptions<Context, Args>,
) {
  const defaultTimeout = validTimeout(options.defaultAttemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS);
  return async (ctx: Context, job: Args) => {
    const timeout = validTimeout(job.attemptTimeoutMs ?? defaultTimeout);
    const attempt = createAttempt(timeout, options.now ?? Date.now);
    try {
      const source = await Promise.race([
        options.resolveSource(ctx, job, attempt.value),
        attempt.aborted,
      ]);
      const result = await ingest(source, {
        ...options.ingestion,
        deadline: attempt.value.deadline,
        signal: attempt.value.signal,
        ...(job.contentType === undefined ? {} : { contentType: job.contentType }),
        ...(job.expectedSha256 === undefined ? {} : { expectedSha256: job.expectedSha256 }),
        ...(job.expectedSize === undefined ? {} : { expectedSize: job.expectedSize }),
        ...(job.filename === undefined ? {} : { filename: job.filename }),
        ...(job.format === undefined ? {} : { format: job.format }),
        ...(job.maxBytes === undefined ? {} : { maxBytes: job.maxBytes }),
      });
      const write = await Promise.race([
        options.writeResult(ctx, job, result, attempt.value),
        attempt.aborted,
      ]);
      return { byteLength: result.source.byteLength, format: result.format, output: write.output, sha256: result.source.sha256, status: write.status };
    } catch (cause) {
      const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined;
      const retryable = cause && typeof cause === "object" && "retryable" in cause ? cause.retryable === true : undefined;
      const terminal = retryable === false || (code !== undefined && TERMINAL_ERROR_CODES.has(code));
      const failure = Object.assign(
        new Error(cause instanceof Error ? cause.message : "AnyDoc ingestion failed.", { cause }),
        {
          code: code ?? "processing-failed",
          retryable: !terminal,
          ...(job.format === undefined ? {} : { format: job.format }),
          ...(job.maxBytes === undefined ? {} : { maxBytes: job.maxBytes }),
          ...(job.expectedSize === undefined ? {} : { expectedSize: job.expectedSize }),
        },
      );
      const encoded = encodeConvexIngestionFailure(failure);
      if (terminal) {
        throw new NonRetryableError(encoded, { cause });
      }
      throw new Error(encoded, { cause });
    } finally {
      attempt.dispose();
    }
  };
}
