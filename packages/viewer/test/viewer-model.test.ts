import { describe, expect, it } from "vitest";

import type { SpreadsheetCell } from "../src/spreadsheet/model.js";

import {
  cellHyperlink,
  normalizeSelection,
  normalizedSelectionRanges,
  safeSpreadsheetHyperlink,
  selectionAddress,
  selectionContains,
  selectionEdges,
  selectionIntersectsColumn,
  selectionIntersectsRow,
  type SpreadsheetSelection,
} from "../src/index.js";

const selection: SpreadsheetSelection = {
  activeRangeIndex: 0,
  ranges: [
    {
      anchorColumn: 2,
      anchorRow: 2,
      focusColumn: 1,
      focusRow: 1,
      kind: "cells",
    },
  ],
};

describe("viewer model", () => {
  it("normalizes and labels cell selections", () => {
    expect(normalizeSelection(selection)).toEqual({ bottom: 2, left: 1, right: 2, top: 1 });
    expect(selectionAddress(selection)).toBe("A1:B2");
    expect(selectionContains(selection, 2, 2)).toBe(true);
    expect(selectionContains(selection, 3, 2)).toBe(false);
    expect(selectionIntersectsColumn(selection, 2)).toBe(true);
    expect(selectionIntersectsColumn(selection, 3)).toBe(false);
    expect(selectionIntersectsRow(selection, 2)).toBe(true);
    expect(selectionIntersectsRow(selection, 3)).toBe(false);
    expect(selectionEdges(selection, 1, 1)).toEqual({
      bottom: false,
      left: true,
      right: false,
      top: true,
    });
    expect(selectionEdges(selection, 2, 2)).toEqual({
      bottom: true,
      left: false,
      right: true,
      top: false,
    });
    expect(selectionEdges(selection, 3, 3)).toBeNull();
  });

  it("models row, column, all, and additive selections", () => {
    const complex: SpreadsheetSelection = {
      activeRangeIndex: 2,
      ranges: [
        { anchorColumn: 2, anchorRow: 1, focusColumn: 4, focusRow: 1, kind: "columns" },
        { anchorColumn: 1, anchorRow: 3, focusColumn: 1, focusRow: 5, kind: "rows" },
        { anchorColumn: 1, anchorRow: 1, focusColumn: 1, focusRow: 1, kind: "all" },
      ],
    };
    expect(selectionAddress(complex)).toBe("B:D, 3:5, All");
    expect(normalizedSelectionRanges(complex)).toEqual([
      { bottom: 1_048_576, left: 2, right: 4, top: 1 },
      { bottom: 5, left: 1, right: 16_384, top: 3 },
      { bottom: 1_048_576, left: 1, right: 16_384, top: 1 },
    ]);
  });

  it("allows explicit safe links and rejects executable schemes", () => {
    expect(safeSpreadsheetHyperlink("https://example.com/report")).toBe(
      "https://example.com/report",
    );
    expect(safeSpreadsheetHyperlink("#Summary!A1")).toBe("#Summary!A1");
    expect(safeSpreadsheetHyperlink("javascript:alert(1)")).toBeNull();
    const linkedCell = (hyperlink: SpreadsheetCell["hyperlink"]) =>
      ({ hyperlink, style: {}, value: "linked" }) as SpreadsheetCell;
    expect(cellHyperlink(linkedCell({ kind: "internal", target: "Summary!A1" }))).toBe(
      "#Summary!A1",
    );
    expect(cellHyperlink(linkedCell({ kind: "external", target: "tel:+33123456789" }))).toBe(
      "tel:+33123456789",
    );
    expect(
      cellHyperlink(linkedCell({ kind: "external", target: "javascript:alert(1)" })),
    ).toBeNull();
  });
});
