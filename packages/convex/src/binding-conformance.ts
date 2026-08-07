import type { WorkId } from "@convex-dev/workpool";
import type { ConvexIngestionJob, ConvexIngestionReceipt, DurableIngestionBinding } from "./index.js";

/** Test-runner-neutral contract suite for app binding adapters. */
export async function runDurableIngestionBindingConformance(
  create: () => { readonly binding: DurableIngestionBinding<ConvexIngestionJob>; readonly ctx: any },
) {
  const { binding, ctx } = create();
  const job: ConvexIngestionJob = {
    entityId: "conformance:document",
    generation: 3,
    idempotencyKey: "conformance:document:v3",
    source: { storageKey: "source" },
    sourceVersion: "v3",
  };
  const first = "work:first" as WorkId;
  const duplicate = "work:duplicate" as WorkId;
  const winner = await binding.bind(ctx, job, first);
  if (winner !== first) throw new Error("A fresh binding must keep its candidate workId.");
  if (await binding.bind(ctx, job, duplicate) !== first) throw new Error("Duplicate enqueue must return the existing workId.");
  const receipt: ConvexIngestionReceipt = { ...job, workId: first };
  if (!await binding.cancel(ctx, receipt)) throw new Error("The current generation must cancel once.");
  if (await binding.cancel(ctx, receipt)) throw new Error("Cancellation must be idempotent and fence the old generation.");
  await binding.status(ctx, receipt);
}
