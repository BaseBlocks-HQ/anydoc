import { columnName, parseCellAddress } from "./coordinates.ts";

const CELL_REFERENCE =
  /(?<![A-Z0-9_.])((?:'(?:[^']|'')+'|[A-Z_][A-Z0-9_.]*)!)?(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]*)/giu;

export function translateSpreadsheetFormula(
  formula: string,
  rowOffset: number,
  columnOffset: number,
): string {
  return formula
    .split(/("(?:[^"]|"")*")/u)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replace(
            CELL_REFERENCE,
            (
              _reference,
              sheet: string | undefined,
              absoluteColumn: string,
              column: string,
              absoluteRow: string,
              row: string,
            ) => {
              const position = parseCellAddress(`${column}${row}`);
              const nextColumn = absoluteColumn ? position.column : position.column + columnOffset;
              const nextRow = absoluteRow ? position.row : position.row + rowOffset;
              if (nextColumn < 1 || nextColumn > 16_384 || nextRow < 1 || nextRow > 1_048_576) {
                return "#REF!";
              }
              return `${sheet ?? ""}${absoluteColumn}${columnName(nextColumn)}${absoluteRow}${nextRow}`;
            },
          ),
    )
    .join("");
}
