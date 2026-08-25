import {
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
} from "./coordinates.js";
import type { SpreadsheetRange, SpreadsheetSheetMetadata } from "./model.js";

const COLUMN_TILE_SIZE = 32;
const ROW_TILE_SIZE = 64;
const MIN_VIEWER_COLUMNS = 50;
const MIN_VIEWER_ROWS = 200;
const VIEWER_COLUMN_BUFFER = 50;
const VIEWER_ROW_BUFFER = 200;

export type SpreadsheetViewerExtent = Readonly<{
  columns: number;
  rows: number;
}>;

export function createSpreadsheetViewerExtent(
  sheet: SpreadsheetSheetMetadata,
): SpreadsheetViewerExtent {
  return {
    columns: Math.min(
      XLSX_MAX_COLUMNS,
      Math.max(MIN_VIEWER_COLUMNS, (sheet.usedRange?.right ?? 0) + VIEWER_COLUMN_BUFFER),
    ),
    rows: Math.min(
      XLSX_MAX_ROWS,
      Math.max(MIN_VIEWER_ROWS, (sheet.usedRange?.bottom ?? 0) + VIEWER_ROW_BUFFER),
    ),
  };
}

export function tileSpreadsheetViewerRange(
  range: SpreadsheetRange,
  extent: SpreadsheetViewerExtent,
): SpreadsheetRange {
  return {
    bottom: Math.min(extent.rows, Math.ceil(range.bottom / ROW_TILE_SIZE) * ROW_TILE_SIZE),
    left: Math.floor((range.left - 1) / COLUMN_TILE_SIZE) * COLUMN_TILE_SIZE + 1,
    right: Math.min(extent.columns, Math.ceil(range.right / COLUMN_TILE_SIZE) * COLUMN_TILE_SIZE),
    top: Math.floor((range.top - 1) / ROW_TILE_SIZE) * ROW_TILE_SIZE + 1,
  };
}
