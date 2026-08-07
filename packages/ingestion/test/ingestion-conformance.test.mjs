import assert from "node:assert/strict";
import test from "node:test";

import { runIngestionJobStoreConformance } from "../src/ingestion-conformance.js";
import { createMemoryJobStore } from "../src/memory.js";

test("the reference store passes the exported adapter conformance suite", async () => {
  let token = 0;
  const result = await runIngestionJobStoreConformance(() => createMemoryJobStore({ makeToken: () => `token-${++token}` }));
  assert.equal(result.total, 12);
  assert.equal(result.passed.length, result.total);
});
