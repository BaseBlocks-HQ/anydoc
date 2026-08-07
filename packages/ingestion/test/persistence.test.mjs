import assert from "node:assert/strict";
import test from "node:test";

import { clonePersistenceValue, decodePersistenceValue, encodePersistenceValue, measurePersistenceValue } from "../src/persistence.js";

test("portable persistence codec round-trips finite JSON values and encoded binary", () => {
  const input = { title: "Résumé 😀", finite: 1.25, flags: [true, false, null], bytes: new Uint8Array([0, 1, 2, 255]) };
  const encoded = encodePersistenceValue(input);
  assert.deepEqual(encoded.value.bytes, { $anydoc: "binary/base64", data: "AAEC/w==" });
  assert.equal(encoded.measurement.binaryBytes, 4);
  const decoded = decodePersistenceValue(encoded.value);
  assert.deepEqual(decoded, input);
  assert.deepEqual(clonePersistenceValue(encoded.value), encoded.value);
});

test("measurement counts UTF-8 exactly without allocating encoded strings", () => {
  const value = { text: "aé😀" };
  const measured = measurePersistenceValue(value);
  assert.equal(measured.textBytes, Buffer.byteLength("textaé😀", "utf8"));
  assert.throws(() => measurePersistenceValue(value, { maxTextBytes: measured.textBytes - 1 }), { code: "output-too-large" });
});

test("early string lower-bound rejection stops before later properties", () => {
  let getterRead = false;
  const value = { text: "x".repeat(32) };
  Object.defineProperty(value, "later", { enumerable: true, get() { getterRead = true; return "unsafe"; } });
  assert.throws(() => measurePersistenceValue(value, { maxTextBytes: 8 }), { code: "output-too-large" });
  assert.equal(getterRead, false);
});

test("non-portable values are rejected before persistence", () => {
  const cycle = {};
  cycle.self = cycle;
  const sparse = new Array(2);
  sparse[1] = "value";
  const accessor = {};
  Object.defineProperty(accessor, "value", { enumerable: true, get() { return "value"; } });
  for (const value of [undefined, () => {}, 1n, Number.NaN, Infinity, new Date(), new Map(), new Set(), new Blob(["x"]), cycle, sparse, accessor]) {
    assert.throws(() => encodePersistenceValue(value), { code: "invalid-persistence" });
  }
  assert.throws(() => encodePersistenceValue({ $anydoc: "binary/base64", data: "AQ==" }), { code: "invalid-persistence" });
  assert.throws(() => clonePersistenceValue({ $anydoc: "binary/base64", data: "not-base64" }), { code: "invalid-persistence" });
  assert.throws(() => clonePersistenceValue({ $anydoc: "binary/base64", data: "AB==" }), { code: "invalid-persistence" });
  assert.throws(() => clonePersistenceValue({ $anydoc: "binary/base64", data: "AAF=" }), { code: "invalid-persistence" });
});

test("symbol metadata is outside the persistence grammar without unbounded reflection", () => {
  const value = { visible: "persisted" };
  value[Symbol("host-metadata")] = { ignored: true };
  const original = Object.getOwnPropertySymbols;
  Object.getOwnPropertySymbols = () => { throw new Error("unbounded symbol enumeration"); };
  try {
    assert.deepEqual(encodePersistenceValue(value).value, { visible: "persisted" });
  } finally {
    Object.getOwnPropertySymbols = original;
  }
});
