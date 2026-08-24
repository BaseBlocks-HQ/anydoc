import { cellKey } from "./coordinates.ts";
import type {
  SpreadsheetAxis,
  SpreadsheetCell,
  SpreadsheetCellStyle,
  SpreadsheetMerge,
  SpreadsheetRange,
  SpreadsheetSheet,
} from "./model.ts";
import { escapeXml } from "./xml.ts";

const DEFAULT_GRID = "#D4D4D8";
const DEFAULT_TEXT = "#18181B";
const DEFAULT_BACKGROUND = "#FFFFFF";

function columnPixels(width: number): number {
  return Math.max(0, Math.min(1_800, Math.floor(width * 7 + 5)));
}

function rowPixels(height: number): number {
  return Math.max(0, Math.min(546, (height * 96) / 72));
}

function axisSize(axis: SpreadsheetAxis, index: number, kind: "column" | "row"): number {
  if (axis.hidden.has(index)) return 0;
  const value = axis.sizes.get(index) ?? axis.defaultSize;
  return kind === "column" ? columnPixels(value) : rowPixels(value);
}

function axisOffsets(
  axis: SpreadsheetAxis,
  start: number,
  end: number,
  kind: "column" | "row",
): ReadonlyMap<number, number> {
  const offsets = new Map<number, number>();
  let current = 0;
  for (let index = start; index <= end + 1; index += 1) {
    offsets.set(index, current);
    if (index <= end) current += axisSize(axis, index, kind);
  }
  return offsets;
}

function containingMerge(
  merges: readonly SpreadsheetMerge[],
  row: number,
  column: number,
): SpreadsheetMerge | undefined {
  return merges.find(
    (merge) =>
      row >= merge.top && row <= merge.bottom && column >= merge.left && column <= merge.right,
  );
}

function displayValue(cell: SpreadsheetCell | undefined): string {
  return cell?.displayValue ?? "";
}

function textAnchor(style: SpreadsheetCellStyle): {
  anchor: "end" | "middle" | "start";
  offset: number;
} {
  if (style.horizontal === "right") return { anchor: "end", offset: -5 };
  if (style.horizontal === "center") return { anchor: "middle", offset: 0 };
  return { anchor: "start", offset: 5 };
}

function fixed(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function renderSpreadsheetRange(sheet: SpreadsheetSheet, range: SpreadsheetRange): string {
  const columns = axisOffsets(sheet.columns, range.left, range.right, "column");
  const rows = axisOffsets(sheet.rows, range.top, range.bottom, "row");
  const width = columns.get(range.right + 1) ?? 0;
  const height = rows.get(range.bottom + 1) ?? 0;
  const elements: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fixed(width)}" height="${fixed(height)}" viewBox="0 0 ${fixed(width)} ${fixed(height)}" role="img" aria-label="${escapeXml(sheet.name)}">`,
    `<rect width="100%" height="100%" fill="${DEFAULT_BACKGROUND}"/>`,
  ];
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      const merge = containingMerge(sheet.merges, row, column);
      if (merge && (merge.top !== row || merge.left !== column)) continue;
      const left = columns.get(column) ?? 0;
      const top = rows.get(row) ?? 0;
      const rightColumn = Math.min(range.right, merge?.right ?? column);
      const bottomRow = Math.min(range.bottom, merge?.bottom ?? row);
      const cellWidth = (columns.get(rightColumn + 1) ?? left) - left;
      const cellHeight = (rows.get(bottomRow + 1) ?? top) - top;
      if (cellWidth <= 0 || cellHeight <= 0) continue;
      const cell = sheet.cells.get(cellKey(row, column));
      const style = cell?.style ?? {};
      elements.push(
        `<rect x="${fixed(left)}" y="${fixed(top)}" width="${fixed(cellWidth)}" height="${fixed(cellHeight)}" fill="${style.background ?? DEFAULT_BACKGROUND}" stroke="${DEFAULT_GRID}" stroke-width="1"/>`,
      );
      const text = displayValue(cell);
      if (!text) continue;
      const horizontal = textAnchor(style);
      const x =
        horizontal.anchor === "middle"
          ? left + cellWidth / 2
          : horizontal.anchor === "end"
            ? left + cellWidth + horizontal.offset
            : left + horizontal.offset;
      const vertical =
        style.vertical === "top"
          ? top + (style.fontSize ?? 11) + 3
          : style.vertical === "middle"
            ? top + cellHeight / 2 + (style.fontSize ?? 11) / 3
            : top + cellHeight - 5;
      elements.push(
        `<text x="${fixed(x)}" y="${fixed(vertical)}" fill="${style.color ?? DEFAULT_TEXT}" font-family="${escapeXml(style.fontFamily ?? "Arial")}" font-size="${fixed(style.fontSize ?? 11)}"${style.bold ? ' font-weight="700"' : ""}${style.italic ? ' font-style="italic"' : ""}${style.underline ? ' text-decoration="underline"' : ""} text-anchor="${horizontal.anchor}">${escapeXml(text)}</text>`,
      );
      const borders: ReadonlyArray<
        readonly [SpreadsheetCellStyle[keyof SpreadsheetCellStyle], number, number, number, number]
      > = [
        [style.borderTop, left, top, left + cellWidth, top],
        [style.borderRight, left + cellWidth, top, left + cellWidth, top + cellHeight],
        [style.borderBottom, left, top + cellHeight, left + cellWidth, top + cellHeight],
        [style.borderLeft, left, top, left, top + cellHeight],
      ];
      for (const [stroke, x1, y1, x2, y2] of borders) {
        if (typeof stroke === "string")
          elements.push(
            `<line x1="${fixed(x1)}" y1="${fixed(y1)}" x2="${fixed(x2)}" y2="${fixed(y2)}" stroke="${stroke}" stroke-width="1"/>`,
          );
      }
    }
  }
  elements.push("</svg>");
  return elements.join("");
}
