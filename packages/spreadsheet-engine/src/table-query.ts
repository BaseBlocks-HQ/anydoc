import { cellAddress, cellKey, columnName, normalizeRange } from "./coordinates.ts";
import type {
  SpreadsheetRange,
  SpreadsheetProjectedValue,
  SpreadsheetScalar,
  SpreadsheetSheet,
  SpreadsheetTableAggregateMetric,
  SpreadsheetTableAggregateQuery,
  SpreadsheetTableAggregateResult,
  SpreadsheetTableColumnProfile,
  SpreadsheetTablePartitionFilter,
  SpreadsheetTablePredicate,
  SpreadsheetTableProfile,
  SpreadsheetTableQuery,
  SpreadsheetTableQueryResult,
} from "./model.ts";

const MAXIMUM_DISTINCT_VALUES = 10_000;
const MAXIMUM_PROFILE_SAMPLE_VALUES = 5;
const MAXIMUM_QUERY_ROWS = 200;
const MAXIMUM_AGGREGATE_GROUPS = 500;
const MAXIMUM_TABLE_COLUMNS = 256;

type TableColumn = Readonly<{ column: number; name: string }>;

function cellValue(sheet: SpreadsheetSheet, row: number, column: number): SpreadsheetScalar {
  const cell = sheet.cells.get(cellKey(row, column));
  return cell?.formula ? (cell.formulaResult ?? null) : (cell?.value ?? null);
}

function projectedCellValue(
  sheet: SpreadsheetSheet,
  row: number,
  column: number,
): SpreadsheetProjectedValue {
  const cell = sheet.cells.get(cellKey(row, column));
  const value = cell?.formula ? (cell.formulaResult ?? null) : (cell?.value ?? null);
  if (value === null || !cell || cell.displayValue === String(value)) return value;
  return { displayValue: cell.displayValue, value };
}

function nonBlank(value: SpreadsheetScalar): boolean {
  return value !== null && value !== "";
}

function tableColumns(sheet: SpreadsheetSheet, range: SpreadsheetRange): readonly TableColumn[] {
  if (range.right - range.left + 1 > MAXIMUM_TABLE_COLUMNS) {
    throw new Error(`Table queries support at most ${MAXIMUM_TABLE_COLUMNS} columns.`);
  }
  const names = new Map<string, number>();
  const columns: TableColumn[] = [];
  for (let column = range.left; column <= range.right; column += 1) {
    const header = cellValue(sheet, range.top, column);
    const base = nonBlank(header) ? String(header).trim() : `Column ${columnName(column)}`;
    const normalized = base || `Column ${columnName(column)}`;
    const occurrence = (names.get(normalized.toLocaleLowerCase()) ?? 0) + 1;
    names.set(normalized.toLocaleLowerCase(), occurrence);
    columns.push({
      column,
      name: occurrence === 1 ? normalized : `${normalized} (${occurrence})`,
    });
  }
  return columns;
}

function resolveColumn(columns: readonly TableColumn[], requested: string): TableColumn {
  const normalized = requested.trim().toLocaleLowerCase();
  const found = columns.find(
    ({ column, name }) =>
      name.toLocaleLowerCase() === normalized ||
      columnName(column).toLocaleLowerCase() === normalized,
  );
  if (!found) throw new Error(`Unknown table column: ${requested}`);
  return found;
}

function compare(left: SpreadsheetScalar, right: SpreadsheetScalar): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

type CompiledPredicate = Readonly<{
  column: number;
  operator: SpreadsheetTablePredicate["operator"];
  value: SpreadsheetScalar;
}>;

function compilePredicates(
  columns: readonly TableColumn[],
  predicates: readonly SpreadsheetTablePredicate[],
): readonly CompiledPredicate[] {
  return predicates.map((predicate) => ({
    column: resolveColumn(columns, predicate.column).column,
    operator: predicate.operator,
    value: predicate.value ?? null,
  }));
}

function matchesPredicate(
  sheet: SpreadsheetSheet,
  row: number,
  predicate: CompiledPredicate,
): boolean {
  const value = cellValue(sheet, row, predicate.column);
  if (predicate.operator === "is-blank") return !nonBlank(value);
  if (predicate.operator === "is-not-blank") return nonBlank(value);
  const expected = predicate.value ?? null;
  if (predicate.operator === "equals") return compare(value, expected) === 0;
  if (predicate.operator === "not-equals") return compare(value, expected) !== 0;
  if (predicate.operator === "greater-than") return compare(value, expected) > 0;
  if (predicate.operator === "greater-than-or-equal") return compare(value, expected) >= 0;
  if (predicate.operator === "less-than") return compare(value, expected) < 0;
  if (predicate.operator === "less-than-or-equal") return compare(value, expected) <= 0;
  const actualText = String(value ?? "").toLocaleLowerCase();
  const expectedText = String(expected ?? "").toLocaleLowerCase();
  if (predicate.operator === "contains") return actualText.includes(expectedText);
  if (predicate.operator === "starts-with") return actualText.startsWith(expectedText);
  return actualText.endsWith(expectedText);
}

function* matchingRows(
  sheet: SpreadsheetSheet,
  range: SpreadsheetRange,
  predicates: readonly CompiledPredicate[],
  partition?: Readonly<{
    column: number;
    selectedKeys: ReadonlySet<string>;
  }>,
): Generator<number> {
  for (let row = range.top + 1; row <= range.bottom; row += 1) {
    if (
      partition &&
      !partition.selectedKeys.has(JSON.stringify(cellValue(sheet, row, partition.column)))
    ) {
      continue;
    }
    if (predicates.every((predicate) => matchesPredicate(sheet, row, predicate))) {
      yield row;
    }
  }
}

function selectedPartitions(
  sheet: SpreadsheetSheet,
  range: SpreadsheetRange,
  columns: readonly TableColumn[],
  partitionBy: string | undefined,
  filters: readonly SpreadsheetTablePartitionFilter[] | undefined,
): Readonly<{ column: number; selectedKeys: ReadonlySet<string> }> | undefined {
  if (!filters?.length) return undefined;
  if (!partitionBy) throw new Error("partitionBy is required when partitionFilters are provided.");
  const partitionColumn = resolveColumn(columns, partitionBy).column;
  const compiledFilters = filters.map((filter) => ({
    predicates: compilePredicates(columns, filter.predicates),
    quantifier: filter.quantifier,
  }));
  const matchesByKey = new Map<string, number>();
  for (let row = range.top + 1; row <= range.bottom; row += 1) {
    const partitionValue = cellValue(sheet, row, partitionColumn);
    if (!nonBlank(partitionValue)) continue;
    const key = JSON.stringify(partitionValue);
    let matches = matchesByKey.get(key) ?? 0;
    compiledFilters.forEach((filter, index) => {
      if (
        (matches & (1 << index)) === 0 &&
        filter.predicates.every((predicate) => matchesPredicate(sheet, row, predicate))
      ) {
        matches |= 1 << index;
      }
    });
    matchesByKey.set(key, matches);
  }
  return {
    column: partitionColumn,
    selectedKeys: new Set(
      [...matchesByKey]
        .filter(([, matches]) =>
          compiledFilters.every((filter, index) => {
            const exists = (matches & (1 << index)) !== 0;
            return filter.quantifier === "exists" ? exists : !exists;
          }),
        )
        .map(([key]) => key),
    ),
  };
}

function profileColumn(
  sheet: SpreadsheetSheet,
  dataRange: SpreadsheetRange | null,
  column: TableColumn,
): SpreadsheetTableColumnProfile {
  const distinct = new Set<string>();
  let distinctCountTruncated = false;
  const sampleValues: SpreadsheetProjectedValue[] = [];
  const sampleValueKeys = new Set<string>();
  let blankCount = 0;
  let nonBlankCount = 0;
  let minimum: number | null = null;
  let maximum: number | null = null;
  const types = { boolean: 0, number: 0, string: 0 };
  if (dataRange) {
    for (let row = dataRange.top; row <= dataRange.bottom; row += 1) {
      const value = cellValue(sheet, row, column.column);
      if (!nonBlank(value)) {
        blankCount += 1;
        continue;
      }
      nonBlankCount += 1;
      if (typeof value === "number") {
        types.number += 1;
        minimum = minimum === null ? value : Math.min(minimum, value);
        maximum = maximum === null ? value : Math.max(maximum, value);
      } else if (typeof value === "boolean") {
        types.boolean += 1;
      } else {
        types.string += 1;
      }
      const distinctKey = JSON.stringify(value);
      if (!distinct.has(distinctKey)) {
        if (distinct.size < MAXIMUM_DISTINCT_VALUES) distinct.add(distinctKey);
        else distinctCountTruncated = true;
      }
      if (
        sampleValues.length < MAXIMUM_PROFILE_SAMPLE_VALUES &&
        !sampleValueKeys.has(distinctKey)
      ) {
        sampleValueKeys.add(distinctKey);
        sampleValues.push(projectedCellValue(sheet, row, column.column));
      }
    }
  }
  return {
    blankCount,
    column: column.column,
    distinctCount: distinct.size,
    distinctCountTruncated,
    maximum,
    minimum,
    name: column.name,
    nonBlankCount,
    sampleValues,
    types,
  };
}

export function profileSpreadsheetTable(
  sheet: SpreadsheetSheet,
  requestedRange: SpreadsheetRange,
): SpreadsheetTableProfile {
  const range = normalizeRange(requestedRange);
  const columns = tableColumns(sheet, range);
  const dataRange = range.bottom > range.top ? { ...range, top: range.top + 1 } : null;
  return {
    columns: columns.map((column) => profileColumn(sheet, dataRange, column)),
    dataRange,
    rowCount: Math.max(0, range.bottom - range.top),
    sheetId: sheet.id,
    sheetName: sheet.name,
  };
}

export function querySpreadsheetTable(
  sheet: SpreadsheetSheet,
  input: SpreadsheetTableQuery,
): SpreadsheetTableQueryResult {
  const range = normalizeRange(input.range);
  const columns = tableColumns(sheet, range);
  const selected = input.columns?.length
    ? input.columns.map((column) => resolveColumn(columns, column))
    : columns;
  const predicates = compilePredicates(columns, input.predicates ?? []);
  const partition = selectedPartitions(
    sheet,
    range,
    columns,
    input.partitionBy,
    input.partitionFilters,
  );
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.max(1, Math.min(MAXIMUM_QUERY_ROWS, Math.floor(input.limit ?? 50)));
  const rows: SpreadsheetProjectedValue[][] = [];
  let matchedRowCount = 0;
  for (const row of matchingRows(sheet, range, predicates, partition)) {
    if (matchedRowCount >= offset && rows.length < limit) {
      rows.push(selected.map(({ column }) => projectedCellValue(sheet, row, column)));
    }
    matchedRowCount += 1;
  }
  return {
    columns: selected.map(({ name }) => name),
    matchedRowCount,
    rows,
    sheetId: sheet.id,
    truncated: offset + rows.length < matchedRowCount,
  };
}

type AggregateState = {
  count: number;
  distinct: Set<string>;
  maximum: number | null;
  minimum: number | null;
  numericCount: number;
  sum: number;
};

function initialAggregateState(): AggregateState {
  return {
    count: 0,
    distinct: new Set(),
    maximum: null,
    minimum: null,
    numericCount: 0,
    sum: 0,
  };
}

function metricName(metric: SpreadsheetTableAggregateMetric): string {
  return metric.name ?? `${metric.operation}${metric.column ? ` ${metric.column}` : ""}`;
}

function aggregateValue(
  state: AggregateState,
  operation: SpreadsheetTableAggregateMetric["operation"],
): SpreadsheetScalar {
  if (operation === "count") return state.count;
  if (operation === "count-distinct") return state.distinct.size;
  if (operation === "sum") return state.sum;
  if (operation === "average") return state.numericCount ? state.sum / state.numericCount : null;
  if (operation === "minimum") return state.minimum;
  return state.maximum;
}

export function aggregateSpreadsheetTable(
  sheet: SpreadsheetSheet,
  input: SpreadsheetTableAggregateQuery,
): SpreadsheetTableAggregateResult {
  const range = normalizeRange(input.range);
  const columns = tableColumns(sheet, range);
  const groups = (input.groupBy ?? []).map((column) => resolveColumn(columns, column));
  const metrics = input.metrics.map((metric) => ({
    column: metric.column ? resolveColumn(columns, metric.column) : null,
    metric,
  }));
  const buckets = new Map<
    string,
    Readonly<{ groupValues: readonly SpreadsheetProjectedValue[]; states: AggregateState[] }>
  >();
  let truncated = false;
  const predicates = compilePredicates(columns, input.predicates ?? []);
  const partition = selectedPartitions(
    sheet,
    range,
    columns,
    input.partitionBy,
    input.partitionFilters,
  );
  for (const row of matchingRows(sheet, range, predicates, partition)) {
    const rawGroupValues = groups.map(({ column }) => cellValue(sheet, row, column));
    const key = JSON.stringify(rawGroupValues);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= MAXIMUM_AGGREGATE_GROUPS) {
        truncated = true;
        continue;
      }
      bucket = {
        groupValues: groups.map(({ column }) => projectedCellValue(sheet, row, column)),
        states: metrics.map(initialAggregateState),
      };
      buckets.set(key, bucket);
    }
    metrics.forEach(({ column, metric }, index) => {
      const state = bucket?.states[index];
      if (!state) return;
      const value = column ? cellValue(sheet, row, column.column) : 1;
      if (metric.operation === "count" && !column) state.count += 1;
      else if (nonBlank(value)) state.count += 1;
      if (metric.operation === "count-distinct" && nonBlank(value)) {
        const distinctKey = JSON.stringify(value);
        if (!state.distinct.has(distinctKey)) {
          if (state.distinct.size < MAXIMUM_DISTINCT_VALUES) state.distinct.add(distinctKey);
          else truncated = true;
        }
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        state.numericCount += 1;
        state.sum += value;
        state.minimum = state.minimum === null ? value : Math.min(state.minimum, value);
        state.maximum = state.maximum === null ? value : Math.max(state.maximum, value);
      }
    });
  }
  return {
    columns: [
      ...groups.map(({ name }) => name),
      ...metrics.map(({ metric }) => metricName(metric)),
    ],
    rows: [...buckets.values()].map((bucket) => [
      ...bucket.groupValues,
      ...bucket.states.map((state, index) =>
        aggregateValue(state, metrics[index]?.metric.operation ?? "count"),
      ),
    ]),
    sheetId: sheet.id,
    truncated,
  };
}

export function tableRangeAddress(range: SpreadsheetRange): string {
  return `${cellAddress(range.top, range.left)}:${cellAddress(range.bottom, range.right)}`;
}
