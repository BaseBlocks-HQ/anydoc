import type { SpreadsheetMerge, SpreadsheetRange } from "./model.ts";

export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;

export function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function columnName(column: number): string {
  assertCoordinate(1, column);
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function cellAddress(row: number, column: number): string {
  assertCoordinate(row, column);
  return `${columnName(column)}${row}`;
}

export function parseCellAddress(address: string): { column: number; row: number } {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/iu.exec(address.trim());
  if (!match) throw new Error(`Invalid cell address: ${address}`);
  const column = [...match[1].toUpperCase()].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  );
  const row = Number(match[2]);
  assertCoordinate(row, column);
  return { column, row };
}

export function parseRangeAddress(address: string): SpreadsheetRange {
  const [start, end = start] = address.split(":");
  if (!start || !end) throw new Error(`Invalid range address: ${address}`);
  const first = parseCellAddress(start);
  const last = parseCellAddress(end);
  return normalizeRange({
    bottom: last.row,
    left: first.column,
    right: last.column,
    top: first.row,
  });
}

export function rangeAddress(range: SpreadsheetRange): string {
  const normalized = normalizeRange(range);
  return `${cellAddress(normalized.top, normalized.left)}:${cellAddress(normalized.bottom, normalized.right)}`;
}

export function normalizeRange(range: SpreadsheetRange): SpreadsheetRange {
  assertCoordinate(range.top, range.left);
  assertCoordinate(range.bottom, range.right);
  return {
    bottom: Math.max(range.top, range.bottom),
    left: Math.min(range.left, range.right),
    right: Math.max(range.left, range.right),
    top: Math.min(range.top, range.bottom),
  };
}

export function mergeEquals(left: SpreadsheetMerge, right: SpreadsheetMerge): boolean {
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.bottom === right.bottom &&
    left.right === right.right
  );
}

export function assertCoordinate(row: number, column: number): void {
  if (!Number.isInteger(row) || row < 1 || row > XLSX_MAX_ROWS) {
    throw new Error(`Row must be between 1 and ${XLSX_MAX_ROWS}.`);
  }
  if (!Number.isInteger(column) || column < 1 || column > XLSX_MAX_COLUMNS) {
    throw new Error(`Column must be between 1 and ${XLSX_MAX_COLUMNS}.`);
  }
}
