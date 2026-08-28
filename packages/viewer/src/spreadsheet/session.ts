import { cellAddress, cellKey } from "./coordinates.js";
import type {
  SpreadsheetAxis,
  SpreadsheetCell,
  SpreadsheetCellStyle,
  SpreadsheetCheckbox,
  SpreadsheetConditionalFormat,
  SpreadsheetCopyResult,
  SpreadsheetDataValidation,
  SpreadsheetMerge,
  SpreadsheetObject,
  SpreadsheetPivotTable,
  SpreadsheetRange,
  SpreadsheetRangeRead,
  SpreadsheetRenderedChart,
  SpreadsheetSearchMatch,
  SpreadsheetSearchResult,
  SpreadsheetSelectionStatistics,
  SpreadsheetSheet,
  SpreadsheetSheetMetadata,
  SpreadsheetTable,
  SpreadsheetWorkbookMetadata,
} from "./model.js";
import type { SpreadsheetWorkbookModel } from "./model.js";
import { openWorkbookModel, parseCsvModel } from "./wasm.js";

const MAX_READ_CELLS = 50_000;
const MAX_COPY_CELLS = 100_000;
const MAX_COPY_CHARACTERS = 10_000_000;
const MAX_INDEXED_STATISTIC_CELLS = 100_000;
const DEFAULT_SEARCH_LIMIT = 500;

export type SpreadsheetOpenLimits = {
  maxCells?: number;
  maxInputBytes?: number;
};

function rangeCellCount(range: SpreadsheetRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

function normalizeRange(range: SpreadsheetRange): SpreadsheetRange {
  assertCoordinate(range.top, range.left);
  assertCoordinate(range.bottom, range.right);
  return {
    bottom: Math.max(range.top, range.bottom),
    left: Math.min(range.left, range.right),
    right: Math.max(range.left, range.right),
    top: Math.min(range.top, range.bottom),
  };
}

function assertCoordinate(row: number, column: number): void {
  if (!Number.isInteger(row) || row < 1) {
    throw new Error("Row must be between 1 and 1048576.");
  }
  if (!Number.isInteger(column) || column < 1) {
    throw new Error("Column must be between 1 and 16384.");
  }
}

function displayValue(cell: SpreadsheetCell | undefined): string {
  return cell?.displayValue ?? "";
}

function checkboxText(checkbox: SpreadsheetCheckbox): string {
  return `${checkbox.checked ? "[x]" : "[ ]"}${checkbox.caption ? ` ${checkbox.caption}` : ""}`;
}

function checkboxValue(sheet: SpreadsheetSheet, row: number, column: number): string {
  return (sheet.checkboxes ?? [])
    .filter((checkbox) => checkbox.row === row && checkbox.column === column)
    .map(checkboxText)
    .join(" ");
}

function compareConditionalValue(
  value: SpreadsheetCell["value"] | undefined,
  operator:
    | "equal"
    | "greater-than"
    | "greater-than-or-equal"
    | "less-than"
    | "less-than-or-equal"
    | "not-equal",
  expected: SpreadsheetCell["value"],
): boolean {
  if (operator === "equal") return value === expected;
  if (operator === "not-equal") return value !== expected;
  if (typeof value !== "number" || typeof expected !== "number") return false;
  if (operator === "greater-than") return value > expected;
  if (operator === "greater-than-or-equal") return value >= expected;
  if (operator === "less-than") return value < expected;
  return value <= expected;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clipToUsedRange(
  range: SpreadsheetRange,
  usedRange: SpreadsheetRange | null,
): SpreadsheetRange | null {
  if (!usedRange) return null;
  const normalized = normalizeRange(range);
  const clipped = {
    bottom: Math.min(normalized.bottom, usedRange.bottom),
    left: Math.max(normalized.left, usedRange.left),
    right: Math.min(normalized.right, usedRange.right),
    top: Math.max(normalized.top, usedRange.top),
  };
  return clipped.top <= clipped.bottom && clipped.left <= clipped.right ? clipped : null;
}

/** Reconstruct `Set`/`Map` axis fields delivered as arrays from the parser. */
function toAxis(axis: {
  defaultSize: number;
  hidden: readonly number[];
  sizes: readonly (readonly [number, number])[];
}): SpreadsheetAxis {
  return {
    defaultSize: axis.defaultSize,
    hidden: new Set(axis.hidden),
    sizes: new Map(axis.sizes.map(([index, size]) => [index, size])),
  };
}

function toCells(cells: readonly SpreadsheetCell[]): ReadonlyMap<string, SpreadsheetCell> {
  return new Map(cells.map((cell) => [cellKey(cell.row, cell.column), cell]));
}

function toSheet(
  sheet: SpreadsheetWorkbookModel["sheets"][number],
): SpreadsheetSheet {
  return {
    checkboxes: sheet.checkboxes ?? [],
    cells: toCells(sheet.cells),
    conditionalFormats: sheet.conditionalFormats,
    columns: toAxis(sheet.columns),
    dataValidations: sheet.dataValidations,
    frozenColumns: sheet.frozenColumns,
    frozenRows: sheet.frozenRows,
    hidden: sheet.hidden,
    id: sheet.id,
    merges: sheet.merges,
    name: sheet.name,
    objects: sheet.objects as readonly SpreadsheetObject[],
    pivotTables: sheet.pivotTables as readonly SpreadsheetPivotTable[],
    rows: toAxis(sheet.rows),
    showGridLines: sheet.showGridLines,
    tables: sheet.tables as readonly SpreadsheetTable[],
    usedRange: sheet.usedRange,
  };
}

function metadataForSheet(sheet: SpreadsheetSheet): SpreadsheetSheetMetadata {
  return {
    ...(sheet.checkboxes && sheet.checkboxes.length > 0 ? { checkboxes: sheet.checkboxes } : {}),
    conditionalFormats: sheet.conditionalFormats,
    columns: sheet.columns,
    dataValidations: sheet.dataValidations,
    frozenColumns: sheet.frozenColumns,
    frozenRows: sheet.frozenRows,
    hidden: sheet.hidden,
    id: sheet.id,
    merges: sheet.merges,
    name: sheet.name,
    objectCount: sheet.objects.length,
    objects: sheet.objects,
    pivotTables: sheet.pivotTables,
    rows: sheet.rows,
    showGridLines: sheet.showGridLines,
    tables: sheet.tables,
    usedRange: sheet.usedRange,
  };
}

export class SpreadsheetReadSession {
  readonly #metadata: SpreadsheetWorkbookMetadata;
  readonly #renderedCharts: ReadonlyMap<string, readonly SpreadsheetRenderedChart[]>;
  readonly #sheets: ReadonlyMap<string, SpreadsheetSheet>;
  readonly #conditionalStyles: ReadonlyMap<string, ReadonlyMap<string, SpreadsheetCellStyle>>;

  constructor(model: SpreadsheetWorkbookModel) {
    const sheets = model.sheets.map(toSheet);
    this.#sheets = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    this.#renderedCharts = new Map(
      sheets.map((sheet) => [
        sheet.id,
        (
          model.sheets.find((candidate) => candidate.id === sheet.id) as SpreadsheetWorkbookModel["sheets"][number]
        ).renderedCharts as readonly SpreadsheetRenderedChart[],
      ]),
    );
    this.#conditionalStyles = new Map(
      sheets.map((sheet) => {
        const resolved = new Map<string, SpreadsheetCellStyle>();
        for (const rule of sheet.conditionalFormats) {
          const candidates = [...sheet.cells.entries()].filter(
            ([, cell]) =>
              cell.row >= rule.range.top &&
              cell.row <= rule.range.bottom &&
              cell.column >= rule.range.left &&
              cell.column <= rule.range.right,
          );
          const counts = new Map<string, number>();
          if (rule.kind !== "cell-is") {
            for (const [, cell] of candidates) {
              const value = cell.formula ? cell.formulaResult : cell.value;
              if (value === null || value === "") continue;
              const key = JSON.stringify(value);
              counts.set(key, (counts.get(key) ?? 0) + 1);
            }
          }
          for (const [key, cell] of candidates) {
            const value = cell.formula ? cell.formulaResult : cell.value;
            let matches = false;
            if (rule.kind === "duplicate-values") {
              matches =
                value !== null && value !== "" && (counts.get(JSON.stringify(value)) ?? 0) > 1;
            } else if (rule.kind === "unique-values") {
              matches = value !== null && value !== "" && counts.get(JSON.stringify(value)) === 1;
            } else if ("operator" in rule) {
              matches = compareConditionalValue(value, rule.operator, rule.formula);
            }
            if (matches) resolved.set(key, { ...(resolved.get(key) ?? cell.style), ...rule.style });
          }
        }
        return [sheet.id, resolved] as const;
      }),
    );
    this.#metadata = {
      dateSystem: model.dateSystem,
      diagnostics: model.diagnostics,
      features: model.features,
      sheets: sheets.map(metadataForSheet),
    };
  }

  static async open(
    bytes: Uint8Array,
    limits?: SpreadsheetOpenLimits,
  ): Promise<SpreadsheetReadSession> {
    const model = await openWorkbookModel(bytes, limits ?? {});
    return new SpreadsheetReadSession(model);
  }

  static async openCsv(
    bytes: Uint8Array,
    limits?: SpreadsheetOpenLimits,
  ): Promise<SpreadsheetReadSession> {
    const model = await parseCsvModel(bytes, limits ?? {});
    return new SpreadsheetReadSession(model);
  }

  get metadata(): SpreadsheetWorkbookMetadata {
    return this.#metadata;
  }

  readRange(sheetId: string, requestedRange: SpreadsheetRange): SpreadsheetRangeRead {
    const sheet = this.#sheet(sheetId);
    const range = normalizeRange(requestedRange);
    if (rangeCellCount(range) > MAX_READ_CELLS) {
      throw new Error(`Range reads are limited to ${MAX_READ_CELLS.toLocaleString()} cells.`);
    }
    const cells: SpreadsheetCell[] = [];
    for (let row = range.top; row <= range.bottom; row += 1) {
      for (let column = range.left; column <= range.right; column += 1) {
        const cell = sheet.cells.get(cellKey(row, column));
        if (cell) {
          const conditionalStyle = this.#conditionalStyles.get(sheetId)?.get(cellKey(row, column));
          cells.push(conditionalStyle ? { ...cell, style: conditionalStyle } : cell);
        }
      }
    }
    return {
      cells,
      range,
      sheetId,
    };
  }

  readCharts(sheetId: string): readonly SpreadsheetRenderedChart[] {
    this.#sheet(sheetId);
    return this.#renderedCharts.get(sheetId) ?? [];
  }

  search(query: string, limit = DEFAULT_SEARCH_LIMIT): SpreadsheetSearchResult {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return { matches: [], total: 0, truncated: false };
    const safeLimit = Math.max(1, Math.min(DEFAULT_SEARCH_LIMIT, Math.floor(limit)));
    const matches: SpreadsheetSearchMatch[] = [];
    let total = 0;
    for (const sheet of this.#sheets.values()) {
      for (const cell of sheet.cells.values()) {
        const value = displayValue(cell);
        const searchable = cell.formula ? `${value} ${cell.formula}` : value;
        if (!searchable.toLocaleLowerCase().includes(normalizedQuery)) continue;
        total += 1;
        if (matches.length < safeLimit) {
          matches.push({
            address: cell.address,
            column: cell.column,
            preview: value || `=${cell.formula ?? ""}`,
            row: cell.row,
            sheetId: sheet.id,
            sheetName: sheet.name,
          });
        }
      }
      for (const checkbox of sheet.checkboxes ?? []) {
        const value = checkboxText(checkbox);
        if (!value.toLocaleLowerCase().includes(normalizedQuery)) continue;
        total += 1;
        if (matches.length < safeLimit) {
          matches.push({
            address: cellAddress(checkbox.row, checkbox.column),
            column: checkbox.column,
            preview: value,
            row: checkbox.row,
            sheetId: sheet.id,
            sheetName: sheet.name,
          });
        }
      }
    }
    return { matches, total, truncated: total > matches.length };
  }

  selectionStatistics(
    sheetId: string,
    requestedRanges: readonly SpreadsheetRange[],
  ): SpreadsheetSelectionStatistics {
    const sheet = this.#sheet(sheetId);
    const ranges = requestedRanges.map(normalizeRange);
    const seen = new Set<string>();
    let count = 0;
    let numericCount = 0;
    let sum = 0;
    let minimum: number | null = null;
    let maximum: number | null = null;
    const addCell = (cell: SpreadsheetCell) => {
      const key = cellKey(cell.row, cell.column);
      if (seen.has(key)) return;
      seen.add(key);
      const value = cell.formula ? cell.formulaResult : cell.value;
      if (value === null || value === undefined || value === "") return;
      count += 1;
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      numericCount += 1;
      sum += value;
      minimum = minimum === null ? value : Math.min(minimum, value);
      maximum = maximum === null ? value : Math.max(maximum, value);
    };
    const requestedCellCount = ranges.reduce((total, range) => total + rangeCellCount(range), 0);
    if (requestedCellCount <= MAX_INDEXED_STATISTIC_CELLS) {
      for (const range of ranges) {
        for (let row = range.top; row <= range.bottom; row += 1) {
          for (let column = range.left; column <= range.right; column += 1) {
            const cell = sheet.cells.get(cellKey(row, column));
            if (cell) addCell(cell);
          }
        }
      }
    } else {
      for (const cell of sheet.cells.values()) {
        if (
          ranges.some(
            (range) =>
              cell.row >= range.top &&
              cell.row <= range.bottom &&
              cell.column >= range.left &&
              cell.column <= range.right,
          )
        ) {
          addCell(cell);
        }
      }
    }
    return {
      average: numericCount ? sum / numericCount : null,
      count,
      maximum,
      minimum,
      numericCount,
      sum: numericCount ? sum : null,
    };
  }

  copy(sheetId: string, requestedRanges: readonly SpreadsheetRange[]): SpreadsheetCopyResult {
    const sheet = this.#sheet(sheetId);
    const ranges = requestedRanges
      .map((range) => clipToUsedRange(range, sheet.usedRange))
      .filter((range): range is SpreadsheetRange => range !== null);
    let remainingCells = MAX_COPY_CELLS;
    let truncated = false;
    const textBlocks: string[] = [];
    const htmlTables: string[] = [];
    for (const range of ranges) {
      if (remainingCells <= 0) {
        truncated = true;
        break;
      }
      const maximumRows = Math.max(1, Math.floor(remainingCells / (range.right - range.left + 1)));
      const bottom = Math.min(range.bottom, range.top + maximumRows - 1);
      if (bottom < range.bottom) truncated = true;
      const textRows: string[] = [];
      const htmlRows: string[] = [];
      for (let row = range.top; row <= bottom; row += 1) {
        const textCells: string[] = [];
        const htmlCells: string[] = [];
        for (let column = range.left; column <= range.right; column += 1) {
          const cellValue = displayValue(sheet.cells.get(cellKey(row, column)));
          const value = [cellValue, checkboxValue(sheet, row, column)].filter(Boolean).join(" ");
          textCells.push(value);
          htmlCells.push(`<td>${escapeHtml(value)}</td>`);
        }
        remainingCells -= textCells.length;
        textRows.push(textCells.join("\t"));
        htmlRows.push(`<tr>${htmlCells.join("")}</tr>`);
      }
      textBlocks.push(textRows.join("\n"));
      htmlTables.push(`<table>${htmlRows.join("")}</table>`);
      if (textBlocks.join("\n\n").length > MAX_COPY_CHARACTERS) {
        truncated = true;
        break;
      }
    }
    const text = textBlocks.join("\n\n").slice(0, MAX_COPY_CHARACTERS);
    return {
      cellCount: MAX_COPY_CELLS - remainingCells,
      html: htmlTables.join("<br>").slice(0, MAX_COPY_CHARACTERS),
      text,
      truncated: truncated || text.length >= MAX_COPY_CHARACTERS,
    };
  }

  suggestAxisSize(sheetId: string, axis: "column" | "row", index: number): number {
    const sheet = this.#sheet(sheetId);
    if (!Number.isInteger(index) || index < 1) throw new Error("Axis index must be positive.");
    if (axis === "column") {
      let maximumCharacters = 0;
      for (const cell of sheet.cells.values()) {
        if (cell.column === index)
          maximumCharacters = Math.max(maximumCharacters, displayValue(cell).length);
      }
      for (const checkbox of sheet.checkboxes ?? []) {
        if (checkbox.column === index)
          maximumCharacters = Math.max(maximumCharacters, checkboxText(checkbox).length + 2);
      }
      return Math.max(40, Math.min(600, Math.ceil(maximumCharacters * 7.2 + 18)));
    }
    let maximumLines = 1;
    for (const cell of sheet.cells.values()) {
      if (cell.row !== index) continue;
      const value = displayValue(cell);
      maximumLines = Math.max(maximumLines, value.split("\n").length);
    }
    return Math.max(20, Math.min(240, maximumLines * 20));
  }

  #sheet(sheetId: string): SpreadsheetSheet {
    const sheet = this.#sheets.get(sheetId);
    if (!sheet) throw new Error(`Unknown worksheet: ${sheetId}`);
    return sheet;
  }
}
