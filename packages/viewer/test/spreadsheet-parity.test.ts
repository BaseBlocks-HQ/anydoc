import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { SpreadsheetReadSession } from "../src/spreadsheet/session.js";

const FIXTURE_ROOT = path.resolve(import.meta.dirname, "../../../tests/fixtures");
const GOLDEN_ROOT = path.resolve(import.meta.dirname, "goldens");

const MAX_READ_CELLS = 50_000;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function canonical(value: unknown): Json {
  if (value instanceof Set) return canonical([...value].sort((a, b) => Number(a) - Number(b)));
  if (value instanceof Map) {
    return canonical([...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, Json> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined) result[key] = canonical(item);
    }
    return result;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return (value ?? null) as Json;
}

function rangeCellCount(range: { top: number; bottom: number; left: number; right: number }) {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

describe("spreadsheet wasm parity", () => {
  let cases: [string, ".xlsx" | ".csv"][] = [];

  beforeAll(async () => {
    cases = [];
    for (const directory of ["xlsx", "csv"] as const) {
      const names = (await readdir(path.join(FIXTURE_ROOT, directory))).filter((name) =>
        name.endsWith(`.${directory}`),
      );
      for (const name of names) cases.push([name, `.${directory}` as ".xlsx" | ".csv"]);
    }
    expect(cases.length).toBeGreaterThan(0);
  });

  it("matches the recorded engine goldens", async () => {
    for (const [name, extension] of cases) {
    const bytes = new Uint8Array(await readFile(path.join(FIXTURE_ROOT, extension.slice(1), name)));
    const golden = JSON.parse(
      await readFile(path.join(GOLDEN_ROOT, `${extension.slice(1)}-${name}.json`), "utf8"),
    ) as Record<string, any>;
    let session: SpreadsheetReadSession;
    try {
      session =
        extension === ".csv"
          ? await SpreadsheetReadSession.openCsv(bytes)
          : await SpreadsheetReadSession.open(bytes);
    } catch (error) {
      expect(golden.openError).toBe(error instanceof Error ? error.message : String(error));
      return;
    }
    expect(golden.openError).toBeNull();
    const metadata = canonical(session.metadata) as Record<string, Json>;
    expect(metadata).toEqual(golden.metadata);
    for (const [index, sheetMetadata] of (metadata.sheets as Record<string, any>[]).entries()) {
      const expected = golden.sheets[index] as Record<string, any>;
      const usedRange = sheetMetadata.usedRange as any;
      const sheetId = sheetMetadata.id as string;
      expect(canonical(session.readCharts(sheetId)), `${name} charts`).toEqual(
        expected.readCharts,
      );
      expect(canonical(session.search("e")), `${name} search`).toEqual(expected.search);
      expect(
        usedRange
          ? canonical(session.selectionStatistics(sheetId, [usedRange]))
          : null,
        `${name} statistics`,
      ).toEqual(expected.selectionStatistics);
      expect(usedRange ? canonical(session.copy(sheetId, [usedRange])) : null, `${name} copy`).toEqual(
        expected.copy,
      );
      expect(
        canonical(session.suggestAxisSize(sheetId, "column", 1)),
        `${name} column width`,
      ).toEqual(expected.suggestAxisSizeColumn1);
      expect(
        canonical(session.suggestAxisSize(sheetId, "row", 1)),
        `${name} row height`,
      ).toEqual(expected.suggestAxisSizeRow1);
      if (usedRange && rangeCellCount(usedRange) <= MAX_READ_CELLS) {
        expect(
          canonical(session.readRange(sheetId, usedRange)),
          `${name} readRange`,
        ).toEqual(expected.readRange);
      }
    }
    }
  });
});
