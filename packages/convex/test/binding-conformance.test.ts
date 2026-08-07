import { describe, it } from "vitest";
import { runDurableIngestionBindingConformance, type ConvexIngestionReceipt, type DurableIngestionBinding } from "../src/index.js";

describe("durable binding conformance", () => {
  it("accepts a CAS-backed binding", async () => {
    await runDurableIngestionBindingConformance(() => {
      let active: ConvexIngestionReceipt | undefined;
      const binding: DurableIngestionBinding<any> = {
        async bind(_ctx, job, candidate) {
          if (!active) active = { ...job, workId: candidate };
          return active!.workId;
        },
        async cancel(_ctx, receipt) {
          if (!active || active.workId !== receipt.workId || active.generation !== receipt.generation) return false;
          active = undefined;
          return true;
        },
        async status() { return active?.workId ?? null; },
      };
      return { binding, ctx: {} as any };
    });
  });
});
