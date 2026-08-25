import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "vitest";

import { SpreadsheetReadSession } from "../src/spreadsheet/engine/index.js";

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

describe("spreadsheet golden dump", () => {
  it("dumps normalized model and query outputs for every spreadsheet fixture", async () => {
    await mkdir(GOLDEN_ROOT, { recursive: true });
    let dumped = 0;
    for (const [directory, extension] of [
      ["xlsx", ".xlsx"],
      ["csv", ".csv"],
    ] as const) {
      const names = (await readdir(path.join(FIXTURE_ROOT, directory))).filter((name) =>
        name.endsWith(extension),
      );
      for (const name of names) {
        const bytes = new Uint8Array(
          await readFile(path.join(FIXTURE_ROOT, directory, name)),
        );
        let dump: Record<string, Json>;
        try {
          const session =
            extension === ".csv"
              ? SpreadsheetReadSession.openCsv(bytes)
              : await SpreadsheetReadSession.open(bytes);
          const metadata = canonical(session.metadata) as Record<string, Json>;
          dump = {
            file: `${directory}/${name}`,
            openError: null,
            metadata,
            sheets: (metadata.sheets as Record<string, Json>[]).map((sheetMetadata) => {
              const used = sheetMetadata.usedRange as Record<string, number> | null;
              const sheetId = sheetMetadata.id as string;
              const charts = canonical(session.readCharts(sheetId));
              const search = canonical(session.search("e"));
              const statistics = used
                ? canonical(session.selectionStatistics(sheetId, [used]))
                : null;
              const copy = used ? canonical(session.copy(sheetId, [used])) : null;
              const suggestColumn = canonical(session.suggestAxisSize(sheetId, "column", 1));
              const suggestRow = canonical(session.suggestAxisSize(sheetId, "row", 1));
              const readRange =
                used && rangeCellCount(used) <= MAX_READ_CELLS
                  ? canonical(session.readRange(sheetId, used))
                  : null;
              return {
                readCharts: charts,
                search,
                selectionStatistics: statistics,
                copy,
                suggestAxisSizeColumn1: suggestColumn,
                suggestAxisSizeRow1: suggestRow,
                readRange,
              };
            }),
          };
          dumped += 1;
        } catch (error) {
          dump = {
            file: `${directory}/${name}`,
            openError: error instanceof Error ? error.message : String(error),
          };
        }
        await writeFile(
          path.join(GOLDEN_ROOT, `${directory}-${name}.json`),
          `${JSON.stringify(dump, null, 2)}\n`,
        );
      }
    }
    if (dumped === 0) throw new Error("No spreadsheet fixtures found.");
  });
});
