import {
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
  cellAddress,
  columnName,
  type SpreadsheetCell,
  type SpreadsheetRange,
} from "./engine/index.js";

export type SpreadsheetSelectionKind = "all" | "cells" | "columns" | "rows";

export type SpreadsheetSelectionRange = Readonly<{
  anchorColumn: number;
  anchorRow: number;
  focusColumn: number;
  focusRow: number;
  kind: SpreadsheetSelectionKind;
}>;

export type SpreadsheetSelection = Readonly<{
  activeRangeIndex: number;
  ranges: ReadonlyArray<SpreadsheetSelectionRange>;
}>;

export const INITIAL_SPREADSHEET_SELECTION: SpreadsheetSelection = {
  activeRangeIndex: 0,
  ranges: [
    {
      anchorColumn: 1,
      anchorRow: 1,
      focusColumn: 1,
      focusRow: 1,
      kind: "cells",
    },
  ],
};

export function createSpreadsheetSelectionRange(
  row: number,
  column: number,
  kind: SpreadsheetSelectionKind = "cells",
): SpreadsheetSelectionRange {
  return {
    anchorColumn: column,
    anchorRow: row,
    focusColumn: column,
    focusRow: row,
    kind,
  };
}

export function activeSelectionRange(selection: SpreadsheetSelection): SpreadsheetSelectionRange {
  return (
    selection.ranges[selection.activeRangeIndex] ??
    selection.ranges.at(-1) ??
    INITIAL_SPREADSHEET_SELECTION.ranges[0]!
  );
}

export function normalizeSelectionRange(selection: SpreadsheetSelectionRange): SpreadsheetRange {
  if (selection.kind === "all") {
    return { bottom: XLSX_MAX_ROWS, left: 1, right: XLSX_MAX_COLUMNS, top: 1 };
  }
  if (selection.kind === "rows") {
    return {
      bottom: Math.max(selection.anchorRow, selection.focusRow),
      left: 1,
      right: XLSX_MAX_COLUMNS,
      top: Math.min(selection.anchorRow, selection.focusRow),
    };
  }
  if (selection.kind === "columns") {
    return {
      bottom: XLSX_MAX_ROWS,
      left: Math.min(selection.anchorColumn, selection.focusColumn),
      right: Math.max(selection.anchorColumn, selection.focusColumn),
      top: 1,
    };
  }
  return {
    bottom: Math.max(selection.anchorRow, selection.focusRow),
    left: Math.min(selection.anchorColumn, selection.focusColumn),
    right: Math.max(selection.anchorColumn, selection.focusColumn),
    top: Math.min(selection.anchorRow, selection.focusRow),
  };
}

export function normalizeSelection(selection: SpreadsheetSelection): SpreadsheetRange {
  return normalizeSelectionRange(activeSelectionRange(selection));
}

export function normalizedSelectionRanges(
  selection: SpreadsheetSelection,
): ReadonlyArray<SpreadsheetRange> {
  return selection.ranges.map(normalizeSelectionRange);
}

function rangeAddress(selection: SpreadsheetSelectionRange): string {
  const range = normalizeSelectionRange(selection);
  if (selection.kind === "all") return "All";
  if (selection.kind === "rows") {
    return range.top === range.bottom ? String(range.top) : `${range.top}:${range.bottom}`;
  }
  if (selection.kind === "columns") {
    const left = columnName(range.left);
    const right = columnName(range.right);
    return left === right ? left : `${left}:${right}`;
  }
  const topLeft = cellAddress(range.top, range.left);
  const bottomRight = cellAddress(range.bottom, range.right);
  return topLeft === bottomRight ? topLeft : `${topLeft}:${bottomRight}`;
}

export function selectionAddress(selection: SpreadsheetSelection): string {
  return selection.ranges.map(rangeAddress).join(", ");
}

export function selectionContains(
  selection: SpreadsheetSelection,
  row: number,
  column: number,
): boolean {
  return selection.ranges.some((selectionRange) => {
    const range = normalizeSelectionRange(selectionRange);
    return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
  });
}

export type SpreadsheetSelectionEdges = Readonly<{
  bottom: boolean;
  left: boolean;
  right: boolean;
  top: boolean;
}>;

export function selectionEdges(
  selection: SpreadsheetSelection,
  row: number,
  column: number,
): SpreadsheetSelectionEdges | null {
  let selected = false;
  let top = false;
  let right = false;
  let bottom = false;
  let left = false;
  for (const selectionRange of selection.ranges) {
    const range = normalizeSelectionRange(selectionRange);
    if (row < range.top || row > range.bottom || column < range.left || column > range.right) {
      continue;
    }
    selected = true;
    top ||= row === range.top;
    right ||= column === range.right;
    bottom ||= row === range.bottom;
    left ||= column === range.left;
  }
  return selected ? { bottom, left, right, top } : null;
}

export function selectionIntersectsColumn(
  selection: SpreadsheetSelection,
  column: number,
): boolean {
  return selection.ranges.some((selectionRange) => {
    const range = normalizeSelectionRange(selectionRange);
    return column >= range.left && column <= range.right;
  });
}

export function selectionIntersectsRow(selection: SpreadsheetSelection, row: number): boolean {
  return selection.ranges.some((selectionRange) => {
    const range = normalizeSelectionRange(selectionRange);
    return row >= range.top && row <= range.bottom;
  });
}

export function replaceActiveSelectionRange(
  selection: SpreadsheetSelection,
  range: SpreadsheetSelectionRange,
): SpreadsheetSelection {
  const ranges = [...selection.ranges];
  const index = Math.max(0, Math.min(selection.activeRangeIndex, ranges.length - 1));
  ranges[index] = range;
  return { activeRangeIndex: index, ranges };
}

export function selectSpreadsheetRange(
  selection: SpreadsheetSelection,
  range: SpreadsheetSelectionRange,
  additive: boolean,
): SpreadsheetSelection {
  if (!additive) return { activeRangeIndex: 0, ranges: [range] };
  return { activeRangeIndex: selection.ranges.length, ranges: [...selection.ranges, range] };
}

export function displayCellValue(cell: SpreadsheetCell | undefined): string {
  return cell?.displayValue ?? "";
}

export function formulaBarValue(cell: SpreadsheetCell | undefined): string {
  return cell?.formula ? `=${cell.formula}` : displayCellValue(cell);
}

export function safeSpreadsheetHyperlink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const target = value.trim();
  if (!target) return null;
  if (target.startsWith("#")) return target;
  try {
    const url = new URL(target);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function cellHyperlink(cell: SpreadsheetCell | undefined): string | null {
  if (!cell?.hyperlink) return null;
  return cell.hyperlink.kind === "internal"
    ? `#${cell.hyperlink.target.replace(/^#/u, "")}`
    : safeSpreadsheetHyperlink(cell.hyperlink.target);
}
