import { describe, expect, it } from "vitest";

import type { SpreadsheetSheetMetadata } from "../src/spreadsheet/model.js";

import { createSpreadsheetViewerExtent, tileSpreadsheetViewerRange } from "../src/index.js";

function sheet(usedRange: SpreadsheetSheetMetadata["usedRange"]): SpreadsheetSheetMetadata {
  return {
    conditionalFormats: [],
    columns: { defaultSize: 8.43, hidden: new Set(), sizes: new Map() },
    dataValidations: [],
    frozenColumns: 0,
    frozenRows: 0,
    hidden: false,
    id: "1",
    merges: [],
    name: "Sheet 1",
    objectCount: 0,
    objects: [],
    pivotTables: [],
    rows: { defaultSize: 15, hidden: new Set(), sizes: new Map() },
    showGridLines: true,
    tables: [],
    usedRange,
  };
}

describe("spreadsheet viewport model", () => {
  it("keeps ordinary workbooks on a native-sized scroll surface", () => {
    expect(createSpreadsheetViewerExtent(sheet({ bottom: 3, left: 1, right: 2, top: 1 }))).toEqual({
      columns: 52,
      rows: 203,
    });
    expect(createSpreadsheetViewerExtent(sheet(null))).toEqual({ columns: 50, rows: 200 });
  });

  it("aligns visible reads to stable tiles and clamps the workbook edge", () => {
    const extent = { columns: 52, rows: 203 };
    expect(tileSpreadsheetViewerRange({ bottom: 17, left: 3, right: 12, top: 8 }, extent)).toEqual({
      bottom: 64,
      left: 1,
      right: 32,
      top: 1,
    });
    expect(
      tileSpreadsheetViewerRange({ bottom: 203, left: 45, right: 52, top: 190 }, extent),
    ).toEqual({ bottom: 203, left: 33, right: 52, top: 129 });
  });
});
