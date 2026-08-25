export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;

export function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function assertCoordinate(row: number, column: number): void {
  if (!Number.isInteger(row) || row < 1 || row > XLSX_MAX_ROWS) {
    throw new Error(`Row must be between 1 and ${XLSX_MAX_ROWS}.`);
  }
  if (!Number.isInteger(column) || column < 1 || column > XLSX_MAX_COLUMNS) {
    throw new Error(`Column must be between 1 and ${XLSX_MAX_COLUMNS}.`);
  }
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
