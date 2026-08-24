import { cellAddress, cellKey, parseRangeAddress, rangeAddress } from "./coordinates.ts";
import type {
  SpreadsheetCell,
  SpreadsheetPivotTable,
  SpreadsheetPivotValue,
  SpreadsheetRange,
  SpreadsheetScalar,
  SpreadsheetSheet,
} from "./model.ts";
import { escapeXml } from "./xml.ts";
import { attributes, decodeXml } from "./xml.ts";

type PivotOutput = Readonly<{
  cells: ReadonlyArray<ReadonlyArray<SpreadsheetScalar>>;
  range: SpreadsheetRange;
}>;

function raw(cell: SpreadsheetCell | undefined): SpreadsheetScalar {
  return cell?.formula ? (cell.formulaResult ?? null) : (cell?.value ?? null);
}

export function sourceHeaders(sheet: SpreadsheetSheet, range: SpreadsheetRange): readonly string[] {
  const used = new Set<string>();
  const headers: string[] = [];
  for (let column = range.left; column <= range.right; column += 1) {
    const value = raw(sheet.cells.get(cellKey(range.top, column)));
    const base = String(value ?? `Column ${column - range.left + 1}`).trim() || "Column";
    let name = base;
    for (let suffix = 2; used.has(name.toLocaleLowerCase()); suffix += 1)
      name = `${base} ${suffix}`;
    used.add(name.toLocaleLowerCase());
    headers.push(name);
  }
  return headers;
}

function fieldIndex(headers: readonly string[], field: string): number {
  const index = headers.findIndex(
    (header) => header.toLocaleLowerCase() === field.toLocaleLowerCase(),
  );
  if (index < 0) throw new Error(`Pivot field does not exist in the source range: ${field}`);
  return index;
}

function summarize(values: readonly SpreadsheetScalar[], metric: SpreadsheetPivotValue): number {
  const numeric = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (metric.summarizeBy === "count")
    return values.filter((value) => value !== null && value !== "").length;
  if (numeric.length === 0) return 0;
  if (metric.summarizeBy === "average")
    return numeric.reduce((total, value) => total + value, 0) / numeric.length;
  if (metric.summarizeBy === "maximum") return Math.max(...numeric);
  if (metric.summarizeBy === "minimum") return Math.min(...numeric);
  return numeric.reduce((total, value) => total + value, 0);
}

export function materializePivot(
  pivot: SpreadsheetPivotTable,
  source: SpreadsheetSheet,
): PivotOutput {
  if (pivot.columnField) {
    throw new Error("Column fields are reserved in the typed model but not yet calculated.");
  }
  const headers = sourceHeaders(source, pivot.sourceRange);
  const rowIndexes = pivot.rowFields.map((field) => fieldIndex(headers, field));
  const valueIndexes = pivot.values.map((metric) => fieldIndex(headers, metric.field));
  const groups = new Map<string, { keys: SpreadsheetScalar[]; values: SpreadsheetScalar[][] }>();
  for (let row = pivot.sourceRange.top + 1; row <= pivot.sourceRange.bottom; row += 1) {
    const sourceRow = headers.map((_, index) =>
      raw(source.cells.get(cellKey(row, pivot.sourceRange.left + index))),
    );
    const keys = rowIndexes.map((index) => sourceRow[index] ?? null);
    const key = JSON.stringify(keys);
    const group = groups.get(key) ?? {
      keys,
      values: pivot.values.map(() => []),
    };
    valueIndexes.forEach((index, metricIndex) =>
      group.values[metricIndex].push(sourceRow[index] ?? null),
    );
    groups.set(key, group);
  }
  const rows: SpreadsheetScalar[][] = [
    [
      ...pivot.rowFields,
      ...pivot.values.map((metric) => metric.name ?? `${metric.summarizeBy} of ${metric.field}`),
    ],
  ];
  for (const group of groups.values()) {
    rows.push([
      ...group.keys,
      ...pivot.values.map((metric, index) => summarize(group.values[index], metric)),
    ]);
  }
  return {
    cells: rows,
    range: {
      bottom: pivot.targetRange.top + rows.length - 1,
      left: pivot.targetRange.left,
      right: pivot.targetRange.left + rows[0].length - 1,
      top: pivot.targetRange.top,
    },
  };
}

export function pivotCacheDefinitionXml(
  pivot: SpreadsheetPivotTable,
  sourceSheetName: string,
  headers: readonly string[],
  recordCount: number,
): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1" saveData="1" refreshOnLoad="1" recordCount="${recordCount}"><cacheSource type="worksheet"><worksheetSource ref="${rangeAddress(pivot.sourceRange)}" sheet="${escapeXml(sourceSheetName)}"/></cacheSource><cacheFields count="${headers.length}">${headers.map((header) => `<cacheField name="${escapeXml(header)}" numFmtId="0"><sharedItems containsBlank="1"/></cacheField>`).join("")}</cacheFields></pivotCacheDefinition>`;
}

function cacheValue(value: SpreadsheetScalar): string {
  if (value === null || value === "") return "<m/>";
  if (typeof value === "number") return `<n v="${value}"/>`;
  if (typeof value === "boolean") return `<b v="${value ? 1 : 0}"/>`;
  return `<s v="${escapeXml(value)}"/>`;
}

export function pivotCacheRecordsXml(source: SpreadsheetSheet, range: SpreadsheetRange): string {
  const records: string[] = [];
  for (let row = range.top + 1; row <= range.bottom; row += 1) {
    const values: SpreadsheetScalar[] = [];
    for (let column = range.left; column <= range.right; column += 1)
      values.push(raw(source.cells.get(cellKey(row, column))));
    records.push(`<r>${values.map(cacheValue).join("")}</r>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotCacheRecords xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${records.length}">${records.join("")}</pivotCacheRecords>`;
}

export function pivotTableDefinitionXml(
  pivot: SpreadsheetPivotTable,
  headers: readonly string[],
  output: PivotOutput,
  cacheId: number,
): string {
  const rowIndexes = pivot.rowFields.map((field) => fieldIndex(headers, field));
  const valueIndexes = pivot.values.map((metric) => fieldIndex(headers, metric.field));
  const rowItems = Math.max(1, output.cells.length - 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${escapeXml(pivot.name)}" cacheId="${cacheId}" dataCaption="Values" updatedVersion="8" minRefreshableVersion="3" useAutoFormatting="1" itemPrintTitles="1" createdVersion="8"><location ref="${rangeAddress(output.range)}" firstHeaderRow="1" firstDataRow="1" firstDataCol="${pivot.rowFields.length}"/><pivotFields count="${headers.length}">${headers.map((_, index) => `<pivotField${rowIndexes.includes(index) ? ' axis="axisRow" showAll="0"' : valueIndexes.includes(index) ? ' dataField="1" showAll="0"' : ' showAll="0"'}/>`).join("")}</pivotFields><rowFields count="${rowIndexes.length}">${rowIndexes.map((index) => `<field x="${index}"/>`).join("")}</rowFields><rowItems count="${rowItems}">${Array.from({ length: rowItems }, () => '<i><x v="0"/></i>').join("")}</rowItems><dataFields count="${pivot.values.length}">${pivot.values.map((metric, index) => `<dataField name="${escapeXml(metric.name ?? `${metric.summarizeBy} of ${metric.field}`)}" fld="${valueIndexes[index]}" subtotal="${metric.summarizeBy === "average" ? "average" : metric.summarizeBy === "count" ? "count" : metric.summarizeBy === "maximum" ? "max" : metric.summarizeBy === "minimum" ? "min" : "sum"}"/>`).join("")}</dataFields><pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`;
}

export function outputStartAddress(pivot: SpreadsheetPivotTable): string {
  return cellAddress(pivot.targetRange.top, pivot.targetRange.left);
}

export function parsePivotTable(input: {
  cacheXml: string;
  pivotXml: string;
  sheetIdForName(name: string): string | undefined;
}): SpreadsheetPivotTable | undefined {
  const pivotRoot = attributes(/<pivotTableDefinition\b([^>]*)>/iu.exec(input.pivotXml)?.[1] ?? "");
  const location = attributes(/<location\b([^>]*)\/?\s*>/iu.exec(input.pivotXml)?.[1] ?? "");
  const source = attributes(/<worksheetSource\b([^>]*)\/?\s*>/iu.exec(input.cacheXml)?.[1] ?? "");
  if (!pivotRoot.name || !location.ref || !source.ref || !source.sheet) return undefined;
  const headers = [...input.cacheXml.matchAll(/<cacheField\b([^>]*)/giu)]
    .map((match) => attributes(match[1]).name)
    .filter((name): name is string => Boolean(name))
    .map(decodeXml);
  const rowFieldsBlock =
    /<rowFields\b[^>]*>([\s\S]*?)<\/rowFields>/iu.exec(input.pivotXml)?.[1] ?? "";
  const rowFields = [...rowFieldsBlock.matchAll(/<field\b([^>]*)\/?\s*>/giu)]
    .map((match) => headers[Number(attributes(match[1]).x)])
    .filter((name): name is string => Boolean(name));
  const values = [...input.pivotXml.matchAll(/<dataField\b([^>]*)\/?\s*>/giu)].flatMap((match) => {
    const attrs = attributes(match[1]);
    const field = headers[Number(attrs.fld)];
    if (!field) return [];
    const summarizeBy = {
      average: "average",
      count: "count",
      max: "maximum",
      min: "minimum",
      sum: "sum",
    }[attrs.subtotal ?? "sum"] as SpreadsheetPivotValue["summarizeBy"] | undefined;
    return [
      {
        field,
        ...(attrs.name ? { name: decodeXml(attrs.name) } : {}),
        summarizeBy: summarizeBy ?? "sum",
      },
    ];
  });
  const sourceSheetId = input.sheetIdForName(decodeXml(source.sheet));
  if (!sourceSheetId) return undefined;
  return {
    id: pivotRoot.cacheId ?? pivotRoot.name,
    name: decodeXml(pivotRoot.name),
    rowFields,
    sourceRange: parseRangeAddress(source.ref),
    sourceSheetId,
    targetRange: parseRangeAddress(location.ref),
    values,
  };
}
