import { describe, expect, it, vi } from "vitest";
import { NonRetryableError } from "@convex-dev/workpool";
import type { ConvexIngestionJob } from "../src/index.js";
import { decodeConvexIngestionFailure } from "../src/index.js";
import { createConvexIngestionHandler } from "../src/node.js";

type Job = ConvexIngestionJob<{ readonly bytes: Uint8Array }>;

describe("createConvexIngestionHandler", () => {
  it("resolves, ingests, and writes through the narrow host bridge", async () => {
    const writeResult = vi.fn(async (_ctx, job: Job, result) => ({
      status: "applied" as const,
      output: { idempotencyKey: job.idempotencyKey, markdown: result.markdown },
    }));
    const handler = createConvexIngestionHandler<{}, Job>({
      resolveSource: (_ctx, job) => job.source.bytes,
      writeResult,
    });

    const output = await handler({}, {
      format: "text",
      entityId: "document:1",
      generation: 1,
      idempotencyKey: "document:1:v1",
      sourceVersion: "v1",
      source: { bytes: new TextEncoder().encode("hello") },
    });

    expect(output.format).toBe("text");
    expect(writeResult).toHaveBeenCalledOnce();
  });

  it("marks deterministic document failures as non-retryable", async () => {
    const handler = createConvexIngestionHandler<{}, Job>({
      resolveSource: (_ctx, job) => job.source.bytes,
      writeResult: () => ({ status: "applied" }),
    });

    const failure = handler({}, {
      format: "text",
      entityId: "document:large",
      generation: 1,
      idempotencyKey: "document:large:v1",
      maxBytes: 0,
      source: { bytes: new Uint8Array([1]) },
      sourceVersion: "v1",
    });
    await expect(failure).rejects.toBeInstanceOf(NonRetryableError);
    await failure.catch((error) => {
      const decoded = decodeConvexIngestionFailure(error.data?.message);
      expect(decoded).toMatchObject({ code: "too-large", retryable: false, limits: { maxBytes: 0 } });
    });
  });

  it("creates a fresh absolute deadline from the per-attempt duration", async () => {
    let now = Date.now();
    const handler = createConvexIngestionHandler<{}, Job>({
      now: () => now,
      resolveSource: (_ctx, job) => job.source.bytes,
      writeResult: () => ({ status: "applied" }),
    });
    const job: Job = {
      attemptTimeoutMs: 500,
      entityId: "document:retry",
      format: "text",
      generation: 1,
      idempotencyKey: "document:retry:v1",
      source: { bytes: new TextEncoder().encode("hello") },
      sourceVersion: "v1",
    };
    await handler({}, job);
    now += 1_000;
    await handler({}, job);
  });

  it("encodes unknown failures as retryable for Workpool exhaustion", async () => {
    const handler = createConvexIngestionHandler<{}, Job>({
      resolveSource: () => { throw new Error("storage temporarily unavailable"); },
      writeResult: () => ({ status: "applied" }),
    });
    const failure = handler({}, {
      entityId: "document:transient",
      generation: 1,
      idempotencyKey: "document:transient:v1",
      source: { bytes: new Uint8Array() },
      sourceVersion: "v1",
    });
    await failure.catch((error) => {
      expect(error).not.toBeInstanceOf(NonRetryableError);
      expect(decodeConvexIngestionFailure(error.message)).toMatchObject({
        code: "processing-failed",
        retryable: true,
      });
    });
  });
});
