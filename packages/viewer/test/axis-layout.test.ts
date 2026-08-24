import { describe, expect, it } from "vitest";

import {
  createSpreadsheetAxisLayout,
  findSpreadsheetAxisIndex,
  getSpreadsheetAxisItems,
  spreadsheetAxisOffset,
  spreadsheetAxisRangeSize,
} from "../src/index.js";

describe("spreadsheet axis layout", () => {
  const layout = createSpreadsheetAxisLayout(
    {
      defaultSize: 15,
      hidden: new Set([4]),
      sizes: new Map([
        [2, 30],
        [1_000_000, 22.5],
      ]),
    },
    1_048_576,
    "row",
  );

  it("computes sparse offsets without allocating the XLSX extent", () => {
    expect(spreadsheetAxisOffset(layout, 0)).toBe(0);
    expect(spreadsheetAxisOffset(layout, 1)).toBe(20);
    expect(spreadsheetAxisOffset(layout, 2)).toBe(60);
    expect(spreadsheetAxisRangeSize(layout, 1, 4)).toBe(60);
    expect(layout.overrideIndexes).toHaveLength(3);
  });

  it("finds and materializes only viewport items", () => {
    expect(findSpreadsheetAxisIndex(layout, 65)).toBe(2);
    const items = getSpreadsheetAxisItems({
      frozenCount: 1,
      layout,
      logicalOffset: 20_000,
      overscan: 2,
      viewportSize: 200,
    });
    expect(items[0]?.index).toBe(0);
    expect(items.length).toBeLessThan(20);
  });

  it("applies local pixel sizes without mutating workbook axis metadata", () => {
    const axis = { defaultSize: 8.43, hidden: new Set<number>(), sizes: new Map<number, number>() };
    const resized = createSpreadsheetAxisLayout(axis, 16_384, "column", new Map([[2, 240]]));
    expect(spreadsheetAxisRangeSize(resized, 1, 2)).toBe(240);
    expect(axis.sizes.size).toBe(0);
    expect(resized.overrideIndexes).toEqual([2]);
  });
});
