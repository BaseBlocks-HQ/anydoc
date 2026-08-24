import { OoxmlArchive, type SpreadsheetOpenLimits } from "./archive.ts";
import { defaultDocumentLimits } from "@baseblocks/anydoc-contracts";
import {
  assertCoordinate,
  cellAddress,
  cellKey,
  mergeEquals,
  normalizeRange,
  parseCellAddress,
  parseRangeAddress,
  rangeAddress,
} from "./coordinates.ts";
import {
  BuiltInFormulaEngine,
  type FormulaEngine,
  type FormulaRecalculationResult,
} from "./formula.ts";
import { spreadsheetCellDisplayValue } from "./display.ts";
import { translateSpreadsheetFormula } from "./formula-fill.ts";
import {
  chartAnchorXml,
  chartXml,
  parseChart,
  renderChartModel,
  type SpreadsheetRenderedChart,
} from "./charts.ts";
import type {
  SpreadsheetAxis,
  SpreadsheetCell,
  SpreadsheetCellInput,
  SpreadsheetCellStyle,
  SpreadsheetDiagnostic,
  SpreadsheetDateSystem,
  SpreadsheetConditionalFormat,
  SpreadsheetDataValidation,
  SpreadsheetFeature,
  SpreadsheetFeatureId,
  SpreadsheetInspection,
  SpreadsheetMerge,
  SpreadsheetObject,
  SpreadsheetPivotTable,
  SpreadsheetOperation,
  SpreadsheetRange,
  SpreadsheetScalar,
  SpreadsheetSheet,
  SpreadsheetTable,
  SpreadsheetVerification,
  SpreadsheetWorkbookModel,
  SpreadsheetTableAggregateQuery,
  SpreadsheetTableAggregateResult,
  SpreadsheetTableProfile,
  SpreadsheetTableQuery,
  SpreadsheetTableQueryResult,
} from "./model.ts";
import { projectWorksheetObjects, type WorksheetProjection } from "./objects.ts";
import {
  OoxmlPackageJournal,
  parseOoxmlRelationships,
  relationshipsPart,
} from "./package-journal.ts";
import {
  materializePivot,
  pivotCacheDefinitionXml,
  pivotCacheRecordsXml,
  pivotTableDefinitionXml,
  parsePivotTable,
  sourceHeaders,
} from "./pivots.ts";
import { renderSpreadsheetRange } from "./render.ts";
import { SpreadsheetStyleStore } from "./styles.ts";
import {
  aggregateSpreadsheetTable,
  profileSpreadsheetTable,
  querySpreadsheetTable,
} from "./table-query.ts";
import {
  parseConditionalFormats,
  parseDataValidations,
  parseTable,
  replaceWorksheetFeatures,
  serializeConditionalFormats,
  tableXml,
} from "./worksheet-features.ts";
import {
  assertWellFormedXml,
  attributes,
  decodeXml,
  elementText,
  escapeXml,
  replaceOrInsertElement,
  replaceRootAttribute,
} from "./xml.ts";

const MAIN_WORKBOOK = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const STYLES = "xl/styles.xml";
const MAX_OPERATION_CELLS = 100_000;
const RELATIONSHIP_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CONTENT_TYPE_BASE = "application/vnd.openxmlformats-officedocument.spreadsheetml";
const CHART_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const DRAWING_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml";

type MutableAxis = {
  defaultSize: number;
  hidden: Set<number>;
  sizes: Map<number, number>;
};

type SheetState = {
  cellStyleIds: Map<string, number>;
  cells: Map<string, SpreadsheetCell>;
  columns: MutableAxis;
  conditionalFormats: SpreadsheetConditionalFormat[];
  dataValidations: SpreadsheetDataValidation[];
  dirty: boolean;
  frozenColumns: number;
  frozenRows: number;
  hidden: boolean;
  hyperlinkCount: number;
  id: string;
  initialContentKeys: ReadonlySet<string>;
  merges: SpreadsheetMerge[];
  name: string;
  objects: SpreadsheetObject[];
  pivotRelationshipIds: string[];
  pivotTables: SpreadsheetPivotTable[];
  originalXml: string;
  partName: string;
  rows: MutableAxis;
  showGridLines: boolean;
  sourceDiagnostics: readonly SpreadsheetDiagnostic[];
  surfacedHyperlinkCount: number;
  tableRelationshipIds: string[];
  tables: SpreadsheetTable[];
  workbookRelationshipId: string;
};

type Relationship = Readonly<{ id: string; target: string; type: string }>;

function normalizeSpreadsheetNamespacePrefix(xml: string): string {
  const root = /<([A-Za-z_][\w.-]*):(workbook|worksheet|styleSheet|sst)\b/u.exec(xml);
  if (!root) return xml;
  const prefix = root[1];
  const tagPrefix = new RegExp(`<(/?)${prefix}:`, "gu");
  const namespace = new RegExp(`xmlns:${prefix}=`, "gu");
  return xml.replace(tagPrefix, "<$1").replace(namespace, "xmlns=");
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = `${base}/${target}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

function parseRelationships(xml: string): ReadonlyMap<string, Relationship> {
  const result = new Map<string, Relationship>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/giu)) {
    const attrs = attributes(match[1]);
    if (attrs.Id && attrs.Target && attrs.Type) {
      result.set(attrs.Id, {
        id: attrs.Id,
        target: attrs.Target,
        type: attrs.Type,
      });
    }
  }
  return result;
}

function parseSharedStrings(xml: string | undefined): readonly string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/giu)].map((match) =>
    [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/giu)]
      .map((text) => decodeXml(text[1]))
      .join(""),
  );
}

function parseScalar(
  raw: string | undefined,
  type: string | undefined,
  shared: readonly string[],
): SpreadsheetScalar {
  if (raw === undefined) return null;
  if (type === "s") return shared[Number(raw)] ?? "";
  if (type === "b") return raw === "1";
  if (type === "str" || type === "inlineStr" || type === "e") return decodeXml(raw);
  const number = Number(raw);
  return Number.isFinite(number) ? number : decodeXml(raw);
}

function expandUsedRange(
  range: SpreadsheetRange | null,
  row: number,
  column: number,
): SpreadsheetRange {
  return range
    ? {
        bottom: Math.max(range.bottom, row),
        left: Math.min(range.left, column),
        right: Math.max(range.right, column),
        top: Math.min(range.top, row),
      }
    : { bottom: row, left: column, right: column, top: row };
}

function sheetUsedRange(sheet: SheetState): SpreadsheetRange | null {
  let result: SpreadsheetRange | null = null;
  for (const cell of sheet.cells.values()) result = expandUsedRange(result, cell.row, cell.column);
  for (const merge of sheet.merges) {
    result = result
      ? {
          bottom: Math.max(result.bottom, merge.bottom),
          left: Math.min(result.left, merge.left),
          right: Math.max(result.right, merge.right),
          top: Math.min(result.top, merge.top),
        }
      : merge;
  }
  return result;
}

function parseSheet(input: {
  cellBudget?: { remaining: number };
  dateSystem: SpreadsheetDateSystem;
  hidden: boolean;
  id: string;
  name: string;
  partName: string;
  projection: WorksheetProjection;
  workbookRelationshipId: string;
  sharedStrings: readonly string[];
  styles: SpreadsheetStyleStore;
  xml: string;
}): SheetState {
  const format = attributes(/<sheetFormatPr\b([^>]*)/iu.exec(input.xml)?.[1] ?? "");
  const view = attributes(/<sheetView\b([^>]*)/iu.exec(input.xml)?.[1] ?? "");
  const pane = attributes(/<pane\b([^>]*)/iu.exec(input.xml)?.[1] ?? "");
  const rows: MutableAxis = {
    defaultSize: Number(format.defaultRowHeight) || 15,
    hidden: new Set(),
    sizes: new Map(),
  };
  const columns: MutableAxis = {
    defaultSize: Number(format.defaultColWidth) || 8.43,
    hidden: new Set(),
    sizes: new Map(),
  };
  for (const match of input.xml.matchAll(/<col\b([^>]*)\/?\s*>/giu)) {
    const attrs = attributes(match[1]);
    const minimum = Math.max(1, Number(attrs.min) || 1);
    const maximum = Math.min(16_384, Number(attrs.max) || minimum);
    for (let index = minimum; index <= maximum; index += 1) {
      if (attrs.hidden === "1") columns.hidden.add(index);
      if (Number(attrs.width) >= 0) columns.sizes.set(index, Number(attrs.width));
    }
  }
  const cells = new Map<string, SpreadsheetCell>();
  const cellStyleIds = new Map<string, number>();
  for (const rowMatch of input.xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/giu)) {
    const rowAttrs = attributes(rowMatch[1]);
    const rowNumber = Number(rowAttrs.r);
    if (Number.isInteger(rowNumber) && rowNumber > 0) {
      if (rowAttrs.hidden === "1") rows.hidden.add(rowNumber);
      if (Number(rowAttrs.ht) >= 0) rows.sizes.set(rowNumber, Number(rowAttrs.ht));
    }
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/giu)) {
      if (input.cellBudget && --input.cellBudget.remaining < 0) {
        throw new Error("Workbook exceeds the spreadsheet cell limit.");
      }
      const attrs = attributes(cellMatch[1]);
      if (!attrs.r) continue;
      const position = parseCellAddress(attrs.r);
      const body = cellMatch[2] ?? "";
      const formula = elementText(body, "f");
      const inline = attrs.t === "inlineStr" ? elementText(body, "t") : undefined;
      const scalar =
        inline === undefined
          ? parseScalar(elementText(body, "v"), attrs.t, input.sharedStrings)
          : inline;
      const styleId = Number(attrs.s) || 0;
      const key = cellKey(position.row, position.column);
      const cell = {
        address: cellAddress(position.row, position.column),
        column: position.column,
        ...(formula ? { formula } : {}),
        ...(formula ? { formulaResult: scalar } : {}),
        row: position.row,
        style: input.styles.resolve(styleId),
        value: formula ? null : scalar,
      };
      cells.set(key, {
        ...cell,
        displayValue: spreadsheetCellDisplayValue(cell, input.dateSystem),
      });
      cellStyleIds.set(key, styleId);
    }
  }
  const merges = [...input.xml.matchAll(/<mergeCell\b([^>]*)\/?\s*>/giu)]
    .map((match) => attributes(match[1]).ref)
    .filter((value): value is string => Boolean(value))
    .map(parseRangeAddress);
  for (const [key, hyperlink] of input.projection.hyperlinks) {
    const previous = cells.get(key);
    if (previous) {
      cells.set(key, { ...previous, hyperlink });
      continue;
    }
    if (input.cellBudget && --input.cellBudget.remaining < 0) {
      throw new Error("Workbook exceeds the spreadsheet cell limit.");
    }
    const [row, column] = key.split(":").map(Number);
    const cell = {
      address: cellAddress(row, column),
      column,
      hyperlink,
      row,
      style: input.styles.resolve(0),
      value: null,
    };
    cells.set(key, {
      ...cell,
      displayValue: spreadsheetCellDisplayValue(cell, input.dateSystem),
    });
    cellStyleIds.set(key, 0);
  }
  return {
    cellStyleIds,
    cells,
    columns,
    conditionalFormats: [...parseConditionalFormats(input.xml, input.styles)],
    dataValidations: [...parseDataValidations(input.xml)],
    dirty: false,
    frozenColumns: Math.max(0, Number(pane.xSplit) || 0),
    frozenRows: Math.max(0, Number(pane.ySplit) || 0),
    hidden: input.hidden,
    hyperlinkCount: input.projection.hyperlinkCount,
    id: input.id,
    initialContentKeys: new Set(
      [...cells]
        .filter(([, cell]) => cell.formula !== undefined || cell.value !== null)
        .map(([key]) => key),
    ),
    merges,
    name: input.name,
    objects: [...input.projection.objects],
    pivotRelationshipIds: [],
    pivotTables: [],
    originalXml: input.xml,
    partName: input.partName,
    rows,
    showGridLines: view.showGridLines !== "0",
    sourceDiagnostics: input.projection.diagnostics,
    surfacedHyperlinkCount: input.projection.surfacedHyperlinkCount,
    tableRelationshipIds: [],
    tables: [],
    workbookRelationshipId: input.workbookRelationshipId,
  };
}

function newContentObjectCollisionDiagnostics(
  sheets: readonly SheetState[],
): readonly SpreadsheetDiagnostic[] {
  const diagnostics: SpreadsheetDiagnostic[] = [];
  for (const sheet of sheets) {
    const anchoredObjects = sheet.objects.filter((object) => object.anchor?.kind === "two-cell");
    if (anchoredObjects.length === 0) continue;
    for (const [key, cell] of sheet.cells) {
      if (
        sheet.initialContentKeys.has(key) ||
        (cell.formula === undefined && cell.value === null)
      ) {
        continue;
      }
      const collision = anchoredObjects.find(({ anchor }) => {
        if (anchor?.kind !== "two-cell") return false;
        return (
          cell.row >= anchor.from.row &&
          cell.row <= anchor.to.row &&
          cell.column >= anchor.from.column &&
          cell.column <= anchor.to.column
        );
      });
      if (!collision) continue;
      diagnostics.push({
        address: cell.address,
        code: "xlsx.layout.new_content_under_object",
        message: `New content at ${sheet.name}!${cell.address} overlaps preserved ${collision.kind} ${collision.name ?? collision.id}. Move the content outside the object's anchor before publishing.`,
        severity: "error",
        sheetId: sheet.id,
      });
    }
  }
  return diagnostics;
}

function featureManifest(
  archive: OoxmlArchive,
  sheets: readonly SheetState[],
  workbookXml: string,
): readonly SpreadsheetFeature[] {
  const names = archive.names();
  const counts = new Map<SpreadsheetFeatureId, number>();
  const editableCounts = new Map<SpreadsheetFeatureId, number>();
  const renderableCounts = new Map<SpreadsheetFeatureId, number>();
  const set = (id: SpreadsheetFeatureId, count: number) => {
    if (count > 0) counts.set(id, count);
  };
  const objects = sheets.flatMap((sheet) => sheet.objects);
  const charts = objects.filter((object) => object.kind === "chart");
  set("charts", charts.length);
  editableCounts.set("charts", charts.filter((object) => object.chart).length);
  renderableCounts.set("charts", charts.filter((object) => object.chart).length);
  set("comments", names.filter((name) => /xl\/comments\d+\.xml$/u.test(name)).length);
  set("drawings", names.filter((name) => /^xl\/drawings\/drawing\d+\.xml$/u.test(name)).length);
  set("images", objects.filter((object) => object.kind === "image").length);
  set(
    "external-links",
    names.filter((name) => name.startsWith("xl/externalLinks/") && name.endsWith(".xml")).length,
  );
  set("macros", names.filter((name) => name.endsWith("vbaProject.bin")).length);
  const pivotCount = Math.max(
    names.filter((name) => /^xl\/pivotTables\/pivotTable\d+\.xml$/u.test(name)).length,
    sheets.reduce((count, sheet) => count + sheet.pivotTables.length, 0),
  );
  set("pivot-tables", pivotCount);
  const typedPivotCount = sheets.reduce((count, sheet) => count + sheet.pivotTables.length, 0);
  editableCounts.set("pivot-tables", typedPivotCount);
  renderableCounts.set("pivot-tables", typedPivotCount);
  const tableCount = Math.max(
    names.filter((name) => name.startsWith("xl/tables/")).length,
    sheets.reduce((count, sheet) => count + sheet.tables.length, 0),
  );
  set("tables", tableCount);
  const typedTableCount = sheets.reduce((count, sheet) => count + sheet.tables.length, 0);
  editableCounts.set("tables", typedTableCount);
  renderableCounts.set("tables", typedTableCount);
  set("defined-names", [...workbookXml.matchAll(/<definedName\b/giu)].length);
  const sheetXml = sheets.map((sheet) => sheet.originalXml).join("\n");
  const rawConditionalCount = [...sheetXml.matchAll(/<conditionalFormatting\b/giu)].length;
  const conditionalCount = Math.max(
    rawConditionalCount,
    sheets.reduce((count, sheet) => count + sheet.conditionalFormats.length, 0),
  );
  set("conditional-formatting", conditionalCount);
  const typedConditionalCount = sheets.reduce(
    (count, sheet) => count + sheet.conditionalFormats.length,
    0,
  );
  editableCounts.set("conditional-formatting", typedConditionalCount);
  renderableCounts.set("conditional-formatting", typedConditionalCount);
  const rawValidationCount = [...sheetXml.matchAll(/<dataValidation\b/giu)].length;
  const validationCount = Math.max(
    rawValidationCount,
    sheets.reduce((count, sheet) => count + sheet.dataValidations.length, 0),
  );
  set("data-validation", validationCount);
  const typedValidationCount = sheets.reduce(
    (count, sheet) => count + sheet.dataValidations.length,
    0,
  );
  editableCounts.set("data-validation", typedValidationCount);
  renderableCounts.set("data-validation", typedValidationCount);
  set(
    "hyperlinks",
    sheets.reduce((count, sheet) => count + sheet.hyperlinkCount, 0),
  );
  const surfacedHyperlinks = sheets.reduce(
    (count, sheet) => count + sheet.surfacedHyperlinkCount,
    0,
  );
  renderableCounts.set("hyperlinks", surfacedHyperlinks);
  return [...counts].map(([id, count]) => ({
    count,
    editableCount: Math.min(count, editableCounts.get(id) ?? 0),
    id,
    renderableCount: Math.min(count, renderableCounts.get(id) ?? 0),
    roundTripPreserved: true,
  }));
}

function featureDiagnostics(
  features: readonly SpreadsheetFeature[],
): readonly SpreadsheetDiagnostic[] {
  return features
    .filter(
      (feature) => feature.editableCount < feature.count || feature.renderableCount < feature.count,
    )
    .map((feature) => ({
      code: `xlsx.feature.${feature.id}`,
      message: `${feature.count} ${feature.id} object(s) are preserved; ${feature.editableCount} are editable and ${feature.renderableCount} are renderable.`,
      severity: "warning" as const,
    }));
}

function publicAxis(axis: MutableAxis): SpreadsheetAxis {
  return {
    defaultSize: axis.defaultSize,
    hidden: axis.hidden,
    sizes: axis.sizes,
  };
}

function publicSheet(sheet: SheetState): SpreadsheetSheet {
  return {
    cells: sheet.cells,
    conditionalFormats: sheet.conditionalFormats,
    columns: publicAxis(sheet.columns),
    dataValidations: sheet.dataValidations,
    frozenColumns: sheet.frozenColumns,
    frozenRows: sheet.frozenRows,
    hidden: sheet.hidden,
    id: sheet.id,
    merges: sheet.merges,
    name: sheet.name,
    objects: sheet.objects,
    pivotTables: sheet.pivotTables,
    rows: publicAxis(sheet.rows),
    showGridLines: sheet.showGridLines,
    tables: sheet.tables,
    usedRange: sheetUsedRange(sheet),
  };
}

function rangeCellCount(range: SpreadsheetRange): number {
  return (range.bottom - range.top + 1) * (range.right - range.left + 1);
}

function encodeCell(cell: SpreadsheetCell, styleId: number): string {
  const style = styleId ? ` s="${styleId}"` : "";
  if (cell.formula) {
    const result = cell.formulaResult;
    const type =
      typeof result === "string" ? ' t="str"' : typeof result === "boolean" ? ' t="b"' : "";
    const value =
      result === null || result === undefined
        ? ""
        : `<v>${escapeXml(typeof result === "boolean" ? (result ? "1" : "0") : String(result))}</v>`;
    return `<c r="${cell.address}"${style}${type}><f>${escapeXml(cell.formula.replace(/^=/u, ""))}</f>${value}</c>`;
  }
  if (cell.value === null) return styleId ? `<c r="${cell.address}"${style}/>` : "";
  if (typeof cell.value === "string")
    return `<c r="${cell.address}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
  if (typeof cell.value === "boolean")
    return `<c r="${cell.address}"${style} t="b"><v>${cell.value ? "1" : "0"}</v></c>`;
  return `<c r="${cell.address}"${style}><v>${cell.value}</v></c>`;
}

function serializeColumns(columns: MutableAxis): string {
  const indexes = [...new Set([...columns.sizes.keys(), ...columns.hidden])].sort(
    (left, right) => left - right,
  );
  if (indexes.length === 0) return "";
  const groups: Array<{
    end: number;
    hidden: boolean;
    start: number;
    width: number;
  }> = [];
  for (const index of indexes) {
    const width = columns.sizes.get(index) ?? columns.defaultSize;
    const hidden = columns.hidden.has(index);
    const previous = groups.at(-1);
    if (
      previous &&
      previous.end + 1 === index &&
      previous.width === width &&
      previous.hidden === hidden
    ) {
      previous.end = index;
      continue;
    }
    groups.push({ end: index, hidden, start: index, width });
  }
  return `<cols>${groups
    .map(
      ({ end, hidden, start, width }) =>
        `<col min="${start}" max="${end}" width="${width}" customWidth="1"${hidden ? ' hidden="1"' : ""}/>`,
    )
    .join("")}</cols>`;
}

function serializeSheet(sheet: SheetState, styles: SpreadsheetStyleStore): string {
  const byRow = new Map<number, SpreadsheetCell[]>();
  for (const cell of sheet.cells.values()) {
    const row = byRow.get(cell.row) ?? [];
    row.push(cell);
    byRow.set(cell.row, row);
  }
  for (const row of sheet.rows.sizes.keys()) if (!byRow.has(row)) byRow.set(row, []);
  for (const row of sheet.rows.hidden) if (!byRow.has(row)) byRow.set(row, []);
  const sheetData = `<sheetData>${[...byRow]
    .sort(([left], [right]) => left - right)
    .map(([rowNumber, cells]) => {
      const height = sheet.rows.sizes.get(rowNumber);
      const rowAttributes = [
        `r="${rowNumber}"`,
        height !== undefined ? `ht="${height}" customHeight="1"` : "",
        sheet.rows.hidden.has(rowNumber) ? 'hidden="1"' : "",
      ]
        .filter(Boolean)
        .join(" ");
      const content = cells
        .sort((left, right) => left.column - right.column)
        .map((cell) =>
          encodeCell(cell, sheet.cellStyleIds.get(cellKey(cell.row, cell.column)) ?? 0),
        )
        .join("");
      return `<row ${rowAttributes}>${content}</row>`;
    })
    .join("")}</sheetData>`;
  const columns = serializeColumns(sheet.columns);
  const merges = sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((merge) => `<mergeCell ref="${rangeAddress(merge)}"/>`).join("")}</mergeCells>`
    : "";
  let xml = replaceOrInsertElement(sheet.originalXml, "cols", columns, ["sheetData"]);
  xml = replaceOrInsertElement(xml, "sheetData", sheetData, ["sheetProtection", "mergeCells"]);
  xml = replaceOrInsertElement(xml, "mergeCells", merges, [
    "conditionalFormatting",
    "dataValidations",
    "hyperlinks",
    "pageMargins",
  ]);
  const usedRange = sheetUsedRange(sheet);
  if (usedRange) {
    const dimension = `<dimension ref="${rangeAddress(usedRange)}"/>`;
    xml = replaceOrInsertElement(xml, "dimension", dimension, [
      "sheetViews",
      "sheetFormatPr",
      "cols",
      "sheetData",
    ]);
  }
  xml = replaceWorksheetFeatures({
    conditionalFormatsXml: serializeConditionalFormats(sheet.conditionalFormats, styles),
    dataValidations: sheet.dataValidations,
    pivotRelationshipIds: sheet.pivotRelationshipIds,
    tableRelationshipIds: sheet.tableRelationshipIds,
    xml,
  });
  return xml;
}

function mergeStyle(
  base: SpreadsheetCellStyle,
  update: SpreadsheetCellStyle,
): SpreadsheetCellStyle {
  return { ...base, ...update };
}

function normalizeCellInput(input: SpreadsheetCellInput | SpreadsheetScalar): SpreadsheetCellInput {
  if (input !== null && typeof input === "object") return input;
  return { value: input };
}

export class SpreadsheetEngine {
  readonly #archive: OoxmlArchive;
  readonly #dateSystem: SpreadsheetDateSystem;
  readonly #journal: OoxmlPackageJournal;
  readonly #sheets: SheetState[];
  readonly #styles: SpreadsheetStyleStore;
  readonly #stylesPart: string;
  readonly #stylesWasMissing: boolean;
  #workbookXml: string;
  #packageChanged = false;
  #formulaDiagnostics: readonly SpreadsheetDiagnostic[] = [];
  #formulasChanged = false;
  #stylesChanged = false;

  private constructor(input: {
    archive: OoxmlArchive;
    dateSystem: SpreadsheetDateSystem;
    sheets: SheetState[];
    styles: SpreadsheetStyleStore;
    stylesPart: string;
    stylesWasMissing: boolean;
    workbookXml: string;
  }) {
    this.#archive = input.archive;
    this.#dateSystem = input.dateSystem;
    this.#journal = new OoxmlPackageJournal(input.archive);
    this.#sheets = input.sheets;
    this.#styles = input.styles;
    this.#stylesPart = input.stylesPart;
    this.#stylesWasMissing = input.stylesWasMissing;
    this.#workbookXml = input.workbookXml;
  }

  static async open(bytes: Uint8Array, limits?: SpreadsheetOpenLimits): Promise<SpreadsheetEngine> {
    const maxCells = limits?.maxCells ?? defaultDocumentLimits.maxSpreadsheetCells;
    if (!Number.isInteger(maxCells) || maxCells < 1)
      throw new Error("Spreadsheet cell limit is invalid.");
    const cellBudget = { remaining: maxCells };
    const archive = await OoxmlArchive.open(bytes, limits);
    for (const required of ["[Content_Types].xml", "_rels/.rels", MAIN_WORKBOOK, WORKBOOK_RELS]) {
      if (!archive.has(required))
        throw new Error(`Workbook is missing required OOXML part: ${required}`);
      if (required.endsWith(".xml") || required.endsWith(".rels")) {
        assertWellFormedXml(archive.text(required), required);
      }
    }
    const workbookXml = normalizeSpreadsheetNamespacePrefix(archive.text(MAIN_WORKBOOK));
    const workbookProperties = attributes(/<workbookPr\b([^>]*)/iu.exec(workbookXml)?.[1] ?? "");
    const dateSystem: SpreadsheetDateSystem = workbookProperties.date1904 === "1" ? "1904" : "1900";
    const relationships = parseRelationships(archive.text(WORKBOOK_RELS));
    const sharedRelationship = [...relationships.values()].find((relationship) =>
      relationship.type.endsWith("/sharedStrings"),
    );
    const sharedPart = sharedRelationship
      ? resolvePart("xl", sharedRelationship.target)
      : undefined;
    if (sharedRelationship && (!sharedPart || !archive.has(sharedPart))) {
      throw new Error(`Shared strings part is missing: ${sharedPart ?? "unknown"}`);
    }
    if (sharedPart) assertWellFormedXml(archive.text(sharedPart), sharedPart);
    const sharedStrings =
      sharedPart && archive.has(sharedPart)
        ? parseSharedStrings(normalizeSpreadsheetNamespacePrefix(archive.text(sharedPart)))
        : [];
    const stylesRelationship = [...relationships.values()].find((relationship) =>
      relationship.type.endsWith("/styles"),
    );
    const stylesPart = stylesRelationship ? resolvePart("xl", stylesRelationship.target) : STYLES;
    if (stylesRelationship && !archive.has(stylesPart)) {
      throw new Error(`Styles part is missing: ${stylesPart}`);
    }
    const stylesWasMissing = !archive.has(stylesPart);
    const stylesXml = archive.has(stylesPart)
      ? normalizeSpreadsheetNamespacePrefix(archive.text(stylesPart))
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>';
    assertWellFormedXml(stylesXml, stylesPart);
    const styles = new SpreadsheetStyleStore(stylesXml);
    const sheets: SheetState[] = [];
    for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/giu)) {
      const attrs = attributes(match[1]);
      const relationship = relationships.get(attrs["r:id"]);
      if (!relationship || !relationship.type.endsWith("/worksheet")) continue;
      const partName = resolvePart("xl", relationship.target);
      if (!archive.has(partName)) throw new Error(`Worksheet part is missing: ${partName}`);
      const sheetXml = normalizeSpreadsheetNamespacePrefix(archive.text(partName));
      assertWellFormedXml(sheetXml, partName);
      const sheetId = attrs.sheetId ?? attrs["r:id"];
      const projection = projectWorksheetObjects({
        archive,
        sheetId,
        sheetPart: partName,
        sheetXml,
      });
      sheets.push(
        parseSheet({
          cellBudget,
          dateSystem,
          hidden: attrs.state === "hidden" || attrs.state === "veryHidden",
          id: sheetId,
          name: attrs.name ?? `Sheet ${sheets.length + 1}`,
          partName,
          projection,
          sharedStrings,
          styles,
          workbookRelationshipId: attrs["r:id"],
          xml: sheetXml,
        }),
      );
    }
    if (sheets.length === 0) throw new Error("Workbook contains no readable worksheets.");
    const pivotCacheRelationships = new Map<number, string>();
    for (const match of workbookXml.matchAll(/<pivotCache\b([^>]*)\/?\s*>/giu)) {
      const attrs = attributes(match[1]);
      const relationship = relationships.get(attrs["r:id"]);
      if (relationship && Number.isFinite(Number(attrs.cacheId))) {
        pivotCacheRelationships.set(Number(attrs.cacheId), resolvePart("xl", relationship.target));
      }
    }
    for (const sheet of sheets) {
      const relationshipPart = relationshipsPart(sheet.partName);
      if (!archive.has(relationshipPart)) continue;
      const sheetRelationships = parseOoxmlRelationships(archive.text(relationshipPart));
      for (const relationship of sheetRelationships) {
        const featurePart = resolvePart(
          sheet.partName.slice(0, sheet.partName.lastIndexOf("/")),
          relationship.target,
        );
        if (!archive.has(featurePart)) continue;
        if (relationship.type.endsWith("/table")) {
          const table = parseTable(featurePart, archive.text(featurePart));
          if (table) {
            sheet.tables.push(table);
            sheet.tableRelationshipIds.push(relationship.id);
          }
        } else if (relationship.type.endsWith("/pivotTable")) {
          const pivotXml = archive.text(featurePart);
          const cacheId = Number(
            attributes(/<pivotTableDefinition\b([^>]*)>/iu.exec(pivotXml)?.[1] ?? "").cacheId,
          );
          const cachePart = pivotCacheRelationships.get(cacheId);
          if (!cachePart || !archive.has(cachePart)) continue;
          const pivot = parsePivotTable({
            cacheXml: archive.text(cachePart),
            pivotXml,
            sheetIdForName: (name) =>
              sheets.find(
                (candidate) => candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
              )?.id,
          });
          if (pivot) {
            sheet.pivotTables.push(pivot);
            sheet.pivotRelationshipIds.push(relationship.id);
          }
        }
      }
    }
    return new SpreadsheetEngine({
      archive,
      dateSystem,
      sheets,
      styles,
      stylesPart,
      stylesWasMissing,
      workbookXml,
    });
  }

  get model(): SpreadsheetWorkbookModel {
    const sheets = this.#sheets.map(publicSheet);
    const features = featureManifest(this.#archive, this.#sheets, this.#workbookXml);
    return {
      dateSystem: this.#dateSystem,
      diagnostics: [
        ...featureDiagnostics(features),
        ...this.#sheets.flatMap((sheet) => sheet.sourceDiagnostics),
        ...this.#formulaDiagnostics,
      ],
      features,
      objects: sheets.flatMap((sheet) => sheet.objects),
      sheets,
    };
  }

  inspect(sheetId: string, range: SpreadsheetRange): SpreadsheetInspection {
    const sheet = this.#sheet(sheetId);
    const normalized = normalizeRange(range);
    if (rangeCellCount(normalized) > MAX_OPERATION_CELLS)
      throw new Error("Inspection range is too large.");
    return {
      cells: [...sheet.cells.values()]
        .filter(
          (cell) =>
            cell.row >= normalized.top &&
            cell.row <= normalized.bottom &&
            cell.column >= normalized.left &&
            cell.column <= normalized.right,
        )
        .sort((left, right) => left.row - right.row || left.column - right.column),
      range: normalized,
      sheet: {
        frozenColumns: sheet.frozenColumns,
        frozenRows: sheet.frozenRows,
        hidden: sheet.hidden,
        id: sheet.id,
        name: sheet.name,
      },
    };
  }

  profileTable(sheetId: string, range: SpreadsheetRange): SpreadsheetTableProfile {
    return profileSpreadsheetTable(publicSheet(this.#sheet(sheetId)), range);
  }

  queryTable(input: SpreadsheetTableQuery): SpreadsheetTableQueryResult {
    return querySpreadsheetTable(publicSheet(this.#sheet(input.sheetId)), input);
  }

  aggregateTable(input: SpreadsheetTableAggregateQuery): SpreadsheetTableAggregateResult {
    return aggregateSpreadsheetTable(publicSheet(this.#sheet(input.sheetId)), input);
  }

  apply(operation: SpreadsheetOperation): void {
    if (operation.kind === "create-sheet") {
      this.#createSheet(operation.name, operation.position);
      return;
    }
    if (operation.kind === "delete-sheet") {
      this.#deleteSheet(operation.sheetId);
      return;
    }
    if (operation.kind === "rename-sheet") {
      this.#renameSheet(operation.sheetId, operation.name);
      return;
    }
    if (operation.kind === "move-sheet") {
      this.#moveSheet(operation.sheetId, operation.position);
      return;
    }
    if (operation.kind === "create-pivot-table") {
      this.#createPivot(operation);
      return;
    }
    const sheet = this.#sheet(operation.sheetId);
    if (operation.kind === "set-sheet-visibility") {
      if (operation.hidden && this.#sheets.filter((candidate) => !candidate.hidden).length === 1) {
        throw new Error("A workbook must contain at least one visible worksheet.");
      }
      sheet.hidden = operation.hidden;
      this.#syncWorkbookSheets();
    } else if (operation.kind === "create-chart") {
      this.#createChart(sheet, operation.chart, operation.anchor);
    } else if (operation.kind === "add-conditional-format") {
      const range = normalizeRange(operation.rule.range);
      sheet.conditionalFormats.push({
        ...operation.rule,
        id: operation.rule.id ?? `cf-${sheet.conditionalFormats.length + 1}`,
        range,
      } as SpreadsheetConditionalFormat);
      this.#stylesChanged = true;
    } else if (operation.kind === "add-data-validation") {
      const range = normalizeRange(operation.rule.range);
      if (operation.rule.source.kind === "values") {
        if (
          operation.rule.source.values.some(
            (value) => value.includes(",") || value.includes('"'),
          ) ||
          operation.rule.source.values.join(",").length > 255
        ) {
          throw new Error(
            "Inline validation values cannot contain commas or quotes and must fit in 255 characters; use a range formula instead.",
          );
        }
      }
      sheet.dataValidations.push({
        ...operation.rule,
        id: operation.rule.id ?? `validation-${sheet.dataValidations.length + 1}`,
        range,
      });
    } else if (operation.kind === "create-table") {
      this.#createTable(sheet, operation);
    } else if (operation.kind === "write-range") {
      if (operation.cells.length === 0) return;
      const columns = Math.max(...operation.cells.map((row) => row.length));
      if (operation.cells.length * columns > MAX_OPERATION_CELLS)
        throw new Error("Write range is too large.");
      assertCoordinate(operation.row + operation.cells.length - 1, operation.column + columns - 1);
      operation.cells.forEach((row, rowOffset) =>
        row.forEach((raw, columnOffset) => {
          const rowNumber = operation.row + rowOffset;
          const columnNumber = operation.column + columnOffset;
          const key = cellKey(rowNumber, columnNumber);
          const previous = sheet.cells.get(key);
          const input = normalizeCellInput(raw);
          const formula = input.formula?.replace(/^=/u, "");
          const cell = {
            address: cellAddress(rowNumber, columnNumber),
            column: columnNumber,
            ...(formula ? { formula } : {}),
            ...(formula && "formulaResult" in input
              ? { formulaResult: input.formulaResult ?? null }
              : {}),
            ...(previous?.hyperlink ? { hyperlink: previous.hyperlink } : {}),
            row: rowNumber,
            style: previous?.style ?? {},
            value: formula ? null : (input.value ?? null),
          };
          sheet.cells.set(key, {
            ...cell,
            displayValue: spreadsheetCellDisplayValue(cell, this.#dateSystem),
          });
          if (!sheet.cellStyleIds.has(key)) sheet.cellStyleIds.set(key, 0);
          if (formula || previous?.formula) this.#formulasChanged = true;
        }),
      );
    } else if (operation.kind === "fill-range") {
      const range = normalizeRange(operation.range);
      if (rangeCellCount(range) > MAX_OPERATION_CELLS) throw new Error("Fill range is too large.");
      const input = normalizeCellInput(operation.input);
      for (let row = range.top; row <= range.bottom; row += 1) {
        for (let column = range.left; column <= range.right; column += 1) {
          const key = cellKey(row, column);
          const previous = sheet.cells.get(key);
          const sourceFormula = input.formula?.replace(/^=/u, "");
          const formula =
            sourceFormula && operation.translateFormula
              ? translateSpreadsheetFormula(sourceFormula, row - range.top, column - range.left)
              : sourceFormula;
          const cell = {
            address: cellAddress(row, column),
            column,
            ...(formula ? { formula } : {}),
            ...(formula && "formulaResult" in input
              ? { formulaResult: input.formulaResult ?? null }
              : {}),
            ...(previous?.hyperlink ? { hyperlink: previous.hyperlink } : {}),
            row,
            style: previous?.style ?? {},
            value: formula ? null : (input.value ?? null),
          };
          sheet.cells.set(key, {
            ...cell,
            displayValue: spreadsheetCellDisplayValue(cell, this.#dateSystem),
          });
          if (!sheet.cellStyleIds.has(key)) sheet.cellStyleIds.set(key, 0);
          if (formula || previous?.formula) this.#formulasChanged = true;
        }
      }
    } else if (operation.kind === "format-range") {
      const range = normalizeRange(operation.range);
      if (rangeCellCount(range) > MAX_OPERATION_CELLS)
        throw new Error("Format range is too large.");
      for (let row = range.top; row <= range.bottom; row += 1) {
        for (let column = range.left; column <= range.right; column += 1) {
          const key = cellKey(row, column);
          const previous = sheet.cells.get(key);
          const style = mergeStyle(previous?.style ?? {}, operation.style);
          const cell = {
            address: cellAddress(row, column),
            column,
            ...(previous?.formula ? { formula: previous.formula } : {}),
            ...(previous?.formulaResult !== undefined
              ? { formulaResult: previous.formulaResult }
              : {}),
            ...(previous?.hyperlink ? { hyperlink: previous.hyperlink } : {}),
            row,
            style,
            value: previous?.value ?? null,
          };
          sheet.cells.set(key, {
            ...cell,
            displayValue: spreadsheetCellDisplayValue(cell, this.#dateSystem),
          });
          sheet.cellStyleIds.set(key, this.#styles.register(style));
        }
      }
      this.#stylesChanged = true;
    } else if (operation.kind === "resize") {
      if (
        !Number.isInteger(operation.start) ||
        !Number.isInteger(operation.end) ||
        operation.start < 1 ||
        operation.end < operation.start
      )
        throw new Error("Invalid resize interval.");
      if (operation.end - operation.start + 1 > MAX_OPERATION_CELLS)
        throw new Error("Resize interval is too large.");
      const axis = operation.axis === "columns" ? sheet.columns : sheet.rows;
      for (let index = operation.start; index <= operation.end; index += 1) {
        if (operation.size !== undefined) {
          if (!Number.isFinite(operation.size) || operation.size < 0)
            throw new Error("Axis size must be a non-negative number.");
          axis.sizes.set(index, operation.size);
        }
        if (operation.hidden === true) axis.hidden.add(index);
        else if (operation.hidden === false) axis.hidden.delete(index);
      }
    } else if (operation.kind === "merge") {
      const range = normalizeRange(operation.range);
      if (
        sheet.merges.some(
          (merge) =>
            !(
              merge.right < range.left ||
              merge.left > range.right ||
              merge.bottom < range.top ||
              merge.top > range.bottom
            ),
        )
      ) {
        throw new Error("Merged ranges may not overlap.");
      }
      sheet.merges.push(range);
    } else {
      const range = normalizeRange(operation.range);
      sheet.merges = sheet.merges.filter((merge) => !mergeEquals(merge, range));
    }
    sheet.dirty = true;
  }

  applyAll(operations: readonly SpreadsheetOperation[]): void {
    for (const operation of operations) this.apply(operation);
  }

  async recalculate(
    formulaEngine: FormulaEngine = new BuiltInFormulaEngine(),
  ): Promise<FormulaRecalculationResult> {
    const result = await formulaEngine.recalculate({
      sheets: this.#sheets.map((sheet) => ({
        cells: new Map(
          [...sheet.cells].map(([key, cell]) => [
            key,
            {
              column: cell.column,
              ...(cell.formula ? { formula: cell.formula } : {}),
              row: cell.row,
              value: cell.value,
            },
          ]),
        ),
        id: sheet.id,
        name: sheet.name,
      })),
    });
    this.#formulaDiagnostics = result.diagnostics;
    for (const update of result.updates) {
      const sheet = this.#sheet(update.sheetId);
      const key = cellKey(update.row, update.column);
      const cell = sheet.cells.get(key);
      if (!cell?.formula) continue;
      const updated = { ...cell, formulaResult: update.value };
      sheet.cells.set(key, {
        ...updated,
        displayValue: spreadsheetCellDisplayValue(updated, this.#dateSystem),
      });
      sheet.dirty = true;
    }
    if (result.updates.length > 0) this.#formulasChanged = true;
    return {
      diagnostics: result.diagnostics,
      engineId: formulaEngine.id,
      evaluatedCells: result.updates.length,
    };
  }

  renderRange(sheetId: string, range: SpreadsheetRange): string {
    return renderSpreadsheetRange(publicSheet(this.#sheet(sheetId)), normalizeRange(range));
  }

  renderCharts(sheetId: string): readonly SpreadsheetRenderedChart[] {
    const sheet = this.#sheet(sheetId);
    const publicModel = publicSheet(sheet);
    return sheet.objects.flatMap((object) =>
      object.chart
        ? [
            renderChartModel(object.chart, publicModel, (name) => {
              const source = this.#sheets.find(
                (candidate) => candidate.id === name || candidate.name === name,
              );
              return source ? publicSheet(source) : undefined;
            }),
          ]
        : [],
    );
  }

  async export(): Promise<Uint8Array> {
    for (const sheet of this.#sheets)
      if (sheet.dirty) this.#journal.write(sheet.partName, serializeSheet(sheet, this.#styles));
    if (this.#stylesChanged) {
      this.#journal.write(this.#stylesPart, this.#styles.serialize());
      if (this.#stylesWasMissing) {
        this.#journal.addRelationship(MAIN_WORKBOOK, {
          target: "styles.xml",
          type: `${RELATIONSHIP_BASE}/styles`,
        });
        this.#journal.addContentType(this.#stylesPart, `${CONTENT_TYPE_BASE}.styles+xml`);
      }
    }
    if (this.#formulasChanged) {
      let workbook = this.#workbookXml;
      if (/<calcPr\b/iu.test(workbook)) {
        workbook = replaceRootAttribute(workbook, "calcPr", "calcMode", "auto");
        workbook = replaceRootAttribute(workbook, "calcPr", "fullCalcOnLoad", "1");
        workbook = replaceRootAttribute(workbook, "calcPr", "forceFullCalc", "1");
      } else {
        workbook = workbook.replace(
          /<\/workbook>\s*$/iu,
          '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
        );
      }
      this.#workbookXml = workbook;
    }
    if (this.#packageChanged || this.#formulasChanged) {
      this.#journal.write(MAIN_WORKBOOK, this.#workbookXml);
    }
    return this.#journal.export();
  }

  async verify(): Promise<SpreadsheetVerification> {
    const bytes = await this.export();
    const sha256 = await sha256Bytes(bytes);
    try {
      const reopened = await SpreadsheetEngine.open(bytes);
      const diagnostics = [
        ...reopened.model.diagnostics,
        ...newContentObjectCollisionDiagnostics(this.#sheets),
      ];
      return {
        byteSize: bytes.byteLength,
        diagnostics,
        sha256,
        sheetCount: reopened.model.sheets.length,
        valid:
          reopened.model.sheets.length > 0 &&
          !diagnostics.some(({ severity }) => severity === "error"),
      };
    } catch (error) {
      return {
        byteSize: bytes.byteLength,
        diagnostics: [
          {
            code: "xlsx.reopen",
            message: error instanceof Error ? error.message : String(error),
            severity: "error",
          },
        ],
        sha256,
        sheetCount: 0,
        valid: false,
      };
    }
  }

  #validateSheetName(name: string, currentId?: string): string {
    const normalized = name.trim();
    if (!normalized || normalized.length > 31 || /[\\/*?:[\]]/u.test(normalized)) {
      throw new Error("Worksheet names must be 1-31 characters and cannot contain \\ / * ? : [ ].");
    }
    if (
      this.#sheets.some(
        (sheet) =>
          sheet.id !== currentId &&
          sheet.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
      )
    ) {
      throw new Error(`Worksheet name already exists: ${normalized}`);
    }
    return normalized;
  }

  #syncWorkbookSheets(): void {
    const sheetsXml = `<sheets>${this.#sheets
      .map(
        (sheet) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${escapeXml(sheet.id)}"${sheet.hidden ? ' state="hidden"' : ""} r:id="${escapeXml(sheet.workbookRelationshipId)}"/>`,
      )
      .join("")}</sheets>`;
    this.#workbookXml = replaceOrInsertElement(this.#workbookXml, "sheets", sheetsXml, [
      "functionGroups",
      "externalReferences",
      "definedNames",
      "calcPr",
    ]);
    this.#packageChanged = true;
  }

  #createSheet(name: string, position?: number): void {
    const normalizedName = this.#validateSheetName(name);
    const partName = this.#journal.allocatePart("xl/worksheets", "sheet");
    const relationship = this.#journal.addRelationship(MAIN_WORKBOOK, {
      target: partName.replace(/^xl\//u, ""),
      type: `${RELATIONSHIP_BASE}/worksheet`,
    });
    const id = String(
      Math.max(
        0,
        ...this.#sheets.map((sheet) => Number(sheet.id)).filter((value) => Number.isFinite(value)),
      ) + 1,
    );
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15" defaultColWidth="8.43"/><sheetData/></worksheet>';
    this.#journal.write(partName, xml);
    this.#journal.addContentType(partName, `${CONTENT_TYPE_BASE}.worksheet+xml`);
    const state = parseSheet({
      dateSystem: this.#dateSystem,
      hidden: false,
      id,
      name: normalizedName,
      partName,
      projection: {
        diagnostics: [],
        hyperlinkCount: 0,
        hyperlinks: new Map(),
        objects: [],
        surfacedHyperlinkCount: 0,
      },
      sharedStrings: [],
      styles: this.#styles,
      workbookRelationshipId: relationship.id,
      xml,
    });
    state.dirty = true;
    const index =
      position === undefined
        ? this.#sheets.length
        : Math.max(0, Math.min(this.#sheets.length, Math.floor(position)));
    this.#sheets.splice(index, 0, state);
    this.#syncWorkbookSheets();
  }

  #deleteSheet(sheetId: string): void {
    if (this.#sheets.length === 1)
      throw new Error("A workbook must contain at least one worksheet.");
    const index = this.#sheets.findIndex((sheet) => sheet.id === sheetId || sheet.name === sheetId);
    if (index < 0) throw new Error(`Worksheet not found: ${sheetId}`);
    const [sheet] = this.#sheets.splice(index, 1);
    this.#removeOwnedPart(sheet.partName);
    this.#journal.removeRelationship(MAIN_WORKBOOK, sheet.workbookRelationshipId);
    this.#syncWorkbookSheets();
  }

  #removeOwnedPart(part: string, visited = new Set<string>()): void {
    if (visited.has(part)) return;
    visited.add(part);
    for (const relationship of this.#journal.relationships(part)) {
      if (relationship.targetMode === "External") continue;
      const target = resolvePart(part.slice(0, part.lastIndexOf("/")), relationship.target);
      this.#removeOwnedPart(target, visited);
    }
    this.#journal.remove(relationshipsPart(part));
    this.#journal.remove(part);
    this.#journal.removeContentType(part);
  }

  #renameSheet(sheetId: string, name: string): void {
    const sheet = this.#sheet(sheetId);
    const previous = sheet.name;
    sheet.name = this.#validateSheetName(name, sheet.id);
    const escapedPrevious = previous.replaceAll(/[$()*+.?[\\\]^{|}-]/gu, "\\$&");
    const quoted = new RegExp(`'${escapedPrevious.replaceAll("'", "''")}'!`, "gu");
    const bare = new RegExp(`\\b${escapedPrevious}!`, "gu");
    const replacement = `'${sheet.name.replaceAll("'", "''")}'!`;
    for (const candidate of this.#sheets) {
      for (const [key, cell] of candidate.cells) {
        if (!cell.formula) continue;
        const formula = cell.formula.replace(quoted, replacement).replace(bare, replacement);
        if (formula !== cell.formula) {
          candidate.cells.set(key, { ...cell, formula });
          candidate.dirty = true;
          this.#formulasChanged = true;
        }
      }
    }
    this.#syncWorkbookSheets();
  }

  #moveSheet(sheetId: string, position: number): void {
    if (!Number.isInteger(position) || position < 0 || position >= this.#sheets.length)
      throw new Error("Worksheet position is outside the workbook.");
    const index = this.#sheets.findIndex((sheet) => sheet.id === sheetId || sheet.name === sheetId);
    if (index < 0) throw new Error(`Worksheet not found: ${sheetId}`);
    const [sheet] = this.#sheets.splice(index, 1);
    this.#sheets.splice(position, 0, sheet);
    this.#syncWorkbookSheets();
  }

  #createChart(
    sheet: SheetState,
    chartInput: Extract<SpreadsheetOperation, { kind: "create-chart" }>["chart"],
    anchor: SpreadsheetObject["anchor"] & {},
  ): void {
    this.#ensureRelationshipNamespace(sheet);
    if (chartInput.series.length === 0) throw new Error("A chart requires at least one series.");
    for (const series of chartInput.series) {
      this.#sheet(series.categories.sheetId ?? sheet.id);
      this.#sheet(series.values.sheetId ?? sheet.id);
      const categories = normalizeRange(series.categories.range);
      const values = normalizeRange(series.values.range);
      if (rangeCellCount(categories) !== rangeCellCount(values)) {
        throw new Error("Chart category and value ranges must contain the same number of cells.");
      }
      if (rangeCellCount(values) > 1_000_000) {
        throw new Error("A chart series is limited to 1,000,000 source cells.");
      }
    }
    const chartPart = this.#journal.allocatePart("xl/charts", "chart");
    const serializedChart = chartXml(
      chartInput,
      (source) => this.#sheet(source.sheetId ?? sheet.id).name,
    );
    const chart = parseChart(chartPart, serializedChart);
    if (!chart) throw new Error("The created chart could not be projected.");
    this.#journal.write(chartPart, serializedChart);
    this.#journal.addContentType(chartPart, CHART_CONTENT_TYPE);
    const existingDrawing = this.#journal
      .relationships(sheet.partName)
      .find((relationship) => relationship.type.endsWith("/drawing"));
    let drawingPart: string;
    let drawingRelationshipId: string;
    if (existingDrawing) {
      drawingRelationshipId = existingDrawing.id;
      drawingPart = resolvePart(
        sheet.partName.slice(0, sheet.partName.lastIndexOf("/")),
        existingDrawing.target,
      );
    } else {
      drawingPart = this.#journal.allocatePart("xl/drawings", "drawing");
      const relationship = this.#journal.addRelationship(sheet.partName, {
        target: `../drawings/${drawingPart.slice(drawingPart.lastIndexOf("/") + 1)}`,
        type: `${RELATIONSHIP_BASE}/drawing`,
      });
      drawingRelationshipId = relationship.id;
      this.#journal.write(
        drawingPart,
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>',
      );
      this.#journal.addContentType(drawingPart, DRAWING_CONTENT_TYPE);
      sheet.originalXml = sheet.originalXml.replace(
        /<\/worksheet>\s*$/iu,
        `<drawing r:id="${relationship.id}"/></worksheet>`,
      );
    }
    const chartRelationship = this.#journal.addRelationship(drawingPart, {
      target: `../charts/${chartPart.slice(chartPart.lastIndexOf("/") + 1)}`,
      type: `${RELATIONSHIP_BASE}/chart`,
    });
    const drawingXml = this.#journal
      .text(drawingPart)
      .replace(
        /<\/xdr:wsDr>\s*$/iu,
        `${chartAnchorXml(anchor, chartRelationship.id, sheet.objects.length + 2, chart.title ?? "Chart")}</xdr:wsDr>`,
      )
      .replace(/\/>\s*$/u, (match) =>
        match === "/>"
          ? `>${chartAnchorXml(anchor, chartRelationship.id, sheet.objects.length + 2, chart.title ?? "Chart")}</xdr:wsDr>`
          : match,
      );
    this.#journal.write(drawingPart, drawingXml);
    sheet.objects.push({
      anchor,
      chart,
      id: `${sheet.id}:${drawingPart}:${sheet.objects.length + 2}`,
      kind: "chart",
      name: chart.title ?? "Chart",
      relationshipTarget: chartPart,
      sheetId: sheet.id,
    });
    void drawingRelationshipId;
    this.#packageChanged = true;
  }

  #createTable(
    sheet: SheetState,
    operation: Extract<SpreadsheetOperation, { kind: "create-table" }>,
  ): void {
    this.#ensureRelationshipNamespace(sheet);
    const range = normalizeRange(operation.range);
    if (range.bottom <= range.top)
      throw new Error("A table requires a header and at least one data row.");
    if (!/^[A-Za-z_\\][A-Za-z0-9_.\\]*$/u.test(operation.name)) {
      throw new Error("Table names must be valid Excel identifiers without spaces.");
    }
    if (
      this.#sheets.some((candidate) =>
        candidate.tables.some(
          (table) => table.name.toLocaleLowerCase() === operation.name.toLocaleLowerCase(),
        ),
      )
    ) {
      throw new Error(`Table name already exists: ${operation.name}`);
    }
    const part = this.#journal.allocatePart("xl/tables", "table");
    const id = part.match(/(\d+)\.xml$/u)?.[1] ?? String(sheet.tables.length + 1);
    const columns = [];
    for (let column = range.left; column <= range.right; column += 1) {
      const cell = sheet.cells.get(cellKey(range.top, column));
      columns.push(cell?.displayValue || `Column${column - range.left + 1}`);
    }
    const table: SpreadsheetTable = {
      columns,
      id,
      name: operation.name,
      range,
      showFilterButtons: operation.showFilterButtons !== false,
      style: operation.style ?? "TableStyleMedium2",
    };
    const relationship = this.#journal.addRelationship(sheet.partName, {
      target: `../tables/${part.slice(part.lastIndexOf("/") + 1)}`,
      type: `${RELATIONSHIP_BASE}/table`,
    });
    this.#journal.write(part, tableXml(table));
    this.#journal.addContentType(part, `${CONTENT_TYPE_BASE}.table+xml`);
    sheet.tables.push(table);
    sheet.tableRelationshipIds.push(relationship.id);
    this.#packageChanged = true;
  }

  #createPivot(operation: Extract<SpreadsheetOperation, { kind: "create-pivot-table" }>): void {
    const source = this.#sheet(operation.sourceSheetId);
    const target = this.#sheet(operation.targetSheetId);
    this.#ensureRelationshipNamespace(target);
    const sourceRange = normalizeRange(operation.sourceRange);
    const targetRange = normalizeRange(operation.targetRange);
    if (
      source.id === target.id &&
      !(
        targetRange.right < sourceRange.left ||
        targetRange.left > sourceRange.right ||
        targetRange.bottom < sourceRange.top ||
        targetRange.top > sourceRange.bottom
      )
    ) {
      throw new Error("PivotTable target cannot overlap its source range.");
    }
    const pivotPart = this.#journal.allocatePart("xl/pivotTables", "pivotTable");
    const cachePart = this.#journal.allocatePart("xl/pivotCache", "pivotCacheDefinition");
    const recordsPart = this.#journal.allocatePart("xl/pivotCache", "pivotCacheRecords");
    const cacheId = Number(cachePart.match(/(\d+)\.xml$/u)?.[1] ?? 1);
    const pivot: SpreadsheetPivotTable = {
      ...(operation.columnField ? { columnField: operation.columnField } : {}),
      id: String(cacheId),
      name: operation.name,
      rowFields: operation.rowFields,
      sourceRange,
      sourceSheetId: source.id,
      targetRange,
      values: operation.values,
    };
    const output = materializePivot(pivot, publicSheet(source));
    this.apply({
      cells: output.cells,
      column: output.range.left,
      kind: "write-range",
      row: output.range.top,
      sheetId: target.id,
    });
    const headers = sourceHeaders(publicSheet(source), pivot.sourceRange);
    this.#journal.write(
      cachePart,
      pivotCacheDefinitionXml(
        pivot,
        source.name,
        headers,
        Math.max(0, pivot.sourceRange.bottom - pivot.sourceRange.top),
      ),
    );
    this.#journal.write(recordsPart, pivotCacheRecordsXml(publicSheet(source), pivot.sourceRange));
    this.#journal.addRelationship(cachePart, {
      id: "rId1",
      target: recordsPart.slice(recordsPart.lastIndexOf("/") + 1),
      type: `${RELATIONSHIP_BASE}/pivotCacheRecords`,
    });
    this.#journal.write(pivotPart, pivotTableDefinitionXml(pivot, headers, output, cacheId));
    const cacheRelationship = this.#journal.addRelationship(MAIN_WORKBOOK, {
      target: cachePart.replace(/^xl\//u, ""),
      type: `${RELATIONSHIP_BASE}/pivotCacheDefinition`,
    });
    const pivotRelationship = this.#journal.addRelationship(target.partName, {
      target: `../pivotTables/${pivotPart.slice(pivotPart.lastIndexOf("/") + 1)}`,
      type: `${RELATIONSHIP_BASE}/pivotTable`,
    });
    for (const [part, contentType] of [
      [cachePart, `${CONTENT_TYPE_BASE}.pivotCacheDefinition+xml`],
      [recordsPart, `${CONTENT_TYPE_BASE}.pivotCacheRecords+xml`],
      [pivotPart, `${CONTENT_TYPE_BASE}.pivotTable+xml`],
    ] as const) {
      this.#journal.addContentType(part, contentType);
    }
    const pivotCache = `<pivotCache cacheId="${cacheId}" r:id="${cacheRelationship.id}"/>`;
    if (/<pivotCaches\b/iu.test(this.#workbookXml)) {
      this.#workbookXml = this.#workbookXml.replace(
        /<\/pivotCaches>/iu,
        `${pivotCache}</pivotCaches>`,
      );
    } else {
      this.#workbookXml = this.#workbookXml.replace(
        /<\/sheets>/iu,
        `</sheets><pivotCaches>${pivotCache}</pivotCaches>`,
      );
    }
    target.pivotTables.push(pivot);
    target.pivotRelationshipIds.push(pivotRelationship.id);
    target.dirty = true;
    this.#packageChanged = true;
  }

  #ensureRelationshipNamespace(sheet: SheetState): void {
    sheet.originalXml = replaceRootAttribute(
      sheet.originalXml,
      "worksheet",
      "xmlns:r",
      RELATIONSHIP_BASE,
    );
  }

  #sheet(sheetId: string): SheetState {
    const sheet = this.#sheets.find(
      (candidate) => candidate.id === sheetId || candidate.name === sheetId,
    );
    if (!sheet) throw new Error(`Worksheet not found: ${sheetId}`);
    return sheet;
  }
}

export async function verifySpreadsheetBytes(
  bytes: Uint8Array,
  limits?: SpreadsheetOpenLimits,
): Promise<SpreadsheetVerification> {
  const sha256 = await sha256Bytes(bytes);
  try {
    const workbook = await SpreadsheetEngine.open(bytes, limits);
    return {
      byteSize: bytes.byteLength,
      diagnostics: workbook.model.diagnostics,
      sha256,
      sheetCount: workbook.model.sheets.length,
      valid: true,
    };
  } catch (error) {
    return {
      byteSize: bytes.byteLength,
      diagnostics: [
        {
          code: "xlsx.open",
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
        },
      ],
      sha256,
      sheetCount: 0,
      valid: false,
    };
  }
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
