import { cellAddress, cellKey, normalizeRange } from "./coordinates.ts";
import { SpreadsheetEngine } from "./engine.ts";
import type {
  SpreadsheetCell,
  SpreadsheetDateSystem,
  SpreadsheetDiagnostic,
  SpreadsheetFeature,
  SpreadsheetRange,
  SpreadsheetSheet,
  SpreadsheetWorkbookModel,
} from "./model.ts";
import type { SpreadsheetRenderedChart } from "./charts.ts";
import type { SpreadsheetOpenLimits } from "./archive.ts";

const MAX_READ_CELLS = 50_000;
const MAX_COPY_CELLS = 100_000;
const MAX_COPY_CHARACTERS = 10_000_000;
const MAX_INDEXED_STATISTIC_CELLS = 100_000;
const DEFAULT_SEARCH_LIMIT = 500;
const MAX_CSV_BYTES = 25 * 1024 * 1024;
const MAX_CSV_ROWS = 100_000;
const MAX_CSV_COLUMNS = 100;
const MAX_CSV_CELLS = 100_000;
const MAX_CSV_CELL_CHARACTERS = 1_000_000;

function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: false }).decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be", { fatal: false }).decode(bytes.subarray(2));
  }
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(offset));
}

function delimiterScore(source: string, delimiter: string): number {
  const counts: number[] = [];
  let count = 0;
  let quoted = false;
  for (let index = 0; index < source.length && counts.length < 20; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) count += 1;
    else if (!quoted && character === "\n") {
      if (count > 0) counts.push(count);
      count = 0;
    }
  }
  if (count > 0) counts.push(count);
  if (counts.length === 0) return 0;
  const frequencies = new Map<number, number>();
  for (const value of counts) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  const [mode, frequency] = [...frequencies.entries()].sort(
    ([leftCount, leftFrequency], [rightCount, rightFrequency]) =>
      rightFrequency - leftFrequency || rightCount - leftCount,
  )[0] ?? [0, 0];
  return mode * frequency;
}

function sniffDelimiter(source: string): string {
  return [",", ";", "\t"].reduce((best, candidate) =>
    delimiterScore(source, candidate) > delimiterScore(source, best) ? candidate : best,
  );
}

function parseCsv(bytes: Uint8Array, limits: SpreadsheetOpenLimits = {}): SpreadsheetWorkbookModel {
  const maxBytes = Math.min(MAX_CSV_BYTES, limits.maxInputBytes ?? MAX_CSV_BYTES);
  const maxCells = Math.min(MAX_CSV_CELLS, limits.maxCells ?? MAX_CSV_CELLS);
  if (bytes.byteLength > maxBytes) throw new Error("CSV input exceeds the byte limit.");
  const source = decodeCsv(bytes);
  const delimiter = sniffDelimiter(source);
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  let cellCount = 0;
  const commitCell = () => {
    if (value.length > MAX_CSV_CELL_CHARACTERS) throw new Error("CSV cell is too large.");
    const row = rows.at(-1);
    if (!row) throw new Error("CSV parser state is invalid.");
    if (row.length >= MAX_CSV_COLUMNS) throw new Error("CSV exceeds the 100 column limit.");
    row.push(value);
    cellCount += 1;
    value = "";
    if (cellCount > maxCells) {
      throw new Error("CSV exceeds the configured cell limit.");
    }
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"' && value.length === 0) quoted = true;
    else if (character === delimiter) commitCell();
    else if (character === "\n") {
      commitCell();
      if (rows.length >= MAX_CSV_ROWS) throw new Error("CSV exceeds the 100,000 row limit.");
      rows.push([]);
    } else if (character !== "\r") value += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  commitCell();
  if (rows.at(-1)?.every((cell) => cell === "")) rows.pop();

  const cells = new Map<string, SpreadsheetCell>();
  let right = 0;
  rows.forEach((row, rowIndex) => {
    right = Math.max(right, row.length);
    row.forEach((displayValue, columnIndex) => {
      if (displayValue === "") return;
      const rowNumber = rowIndex + 1;
      const column = columnIndex + 1;
      const address = cellAddress(rowNumber, column);
      cells.set(cellKey(rowNumber, column), {
        address,
        column,
        displayValue,
        row: rowNumber,
        style: {},
        value: displayValue,
      });
    });
  });
  const sheet: SpreadsheetSheet = {
    cells,
    conditionalFormats: [],
    columns: { defaultSize: 12, hidden: new Set(), sizes: new Map() },
    dataValidations: [],
    frozenColumns: 0,
    frozenRows: 0,
    hidden: false,
    id: "csv-sheet-1",
    merges: [],
    name: "CSV",
    objects: [],
    pivotTables: [],
    rows: { defaultSize: 20, hidden: new Set(), sizes: new Map() },
    showGridLines: true,
    tables: [],
    usedRange: rows.length > 0 ? { bottom: rows.length, left: 1, right, top: 1 } : null,
  };
  return { dateSystem: "1900", diagnostics: [], features: [], objects: [], sheets: [sheet] };
}

export type SpreadsheetSheetMetadata = Readonly<
  Omit<SpreadsheetSheet, "cells"> & { objectCount: number }
>;

export type SpreadsheetWorkbookMetadata = Readonly<{
  dateSystem: SpreadsheetDateSystem;
  diagnostics: ReadonlyArray<SpreadsheetDiagnostic>;
  features: ReadonlyArray<SpreadsheetFeature>;
  sheets: ReadonlyArray<SpreadsheetSheetMetadata>;
}>;

export type SpreadsheetRangeRead = Readonly<{
  cells: ReadonlyArray<SpreadsheetCell>;
  range: SpreadsheetRange;
  sheetId: string;
}>;

export type SpreadsheetSearchMatch = Readonly<{
  address: string;
  column: number;
  preview: string;
  row: number;
  sheetId: string;
  sheetName: string;
}>;

export type SpreadsheetSearchResult = Readonly<{
  matches: ReadonlyArray<SpreadsheetSearchMatch>;
  total: number;
  truncated: boolean;
}>;

export type SpreadsheetSelectionStatistics = Readonly<{
  average: number | null;
  count: number;
  maximum: number | null;
  minimum: number | null;
  numericCount: number;
  sum: number | null;
}>;

export type SpreadsheetCopyResult = Readonly<{
  cellCount: number;
  html: string;
  text: string;
  truncated: boolean;
}>;

function rangeCellCount(range: SpreadsheetRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

function displayValue(cell: SpreadsheetCell | undefined): string {
  return cell?.displayValue ?? "";
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

function metadataForSheet(sheet: SpreadsheetSheet): SpreadsheetSheetMetadata {
  return {
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
  readonly #conditionalStyles: ReadonlyMap<string, ReadonlyMap<string, SpreadsheetCell["style"]>>;

  private constructor(
    model: SpreadsheetWorkbookModel,
    renderedCharts: ReadonlyMap<string, readonly SpreadsheetRenderedChart[]>,
  ) {
    this.#sheets = new Map(model.sheets.map((sheet) => [sheet.id, sheet]));
    this.#renderedCharts = renderedCharts;
    this.#conditionalStyles = new Map(
      model.sheets.map((sheet) => {
        const resolved = new Map<string, SpreadsheetCell["style"]>();
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
      sheets: model.sheets.map(metadataForSheet),
    };
  }

  static async open(bytes: Uint8Array, limits?: SpreadsheetOpenLimits): Promise<SpreadsheetReadSession> {
    const engine = await SpreadsheetEngine.open(bytes, limits);
    return new SpreadsheetReadSession(
      engine.model,
      new Map(engine.model.sheets.map((sheet) => [sheet.id, engine.renderCharts(sheet.id)])),
    );
  }

  static openCsv(bytes: Uint8Array, limits?: SpreadsheetOpenLimits): SpreadsheetReadSession {
    return new SpreadsheetReadSession(parseCsv(bytes, limits), new Map());
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
          const value = displayValue(sheet.cells.get(cellKey(row, column)));
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
