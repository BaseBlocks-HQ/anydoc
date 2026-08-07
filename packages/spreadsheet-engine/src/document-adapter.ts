import type {
  DocumentCommandSchema,
  DocumentDiagnostic,
  DocumentEngineVerification,
  DocumentFormatEngine,
} from "./document-contracts.ts";

import { parseRangeAddress } from "./coordinates.ts";
import { SpreadsheetEngine } from "./engine.ts";
import type {
  SpreadsheetCellInput,
  SpreadsheetCellStyle,
  SpreadsheetDiagnostic,
  SpreadsheetOperation,
  SpreadsheetRange,
  SpreadsheetScalar,
  SpreadsheetTableAggregateMetric,
  SpreadsheetTablePartitionFilter,
  SpreadsheetTablePredicate,
} from "./model.ts";

const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
const MAX_RANGE_CELLS = 100_000;
const MAX_TABLE_CELLS = 2_000_000;
const FORMULA_ERRORS = new Set([
  "#DIV/0!",
  "#N/A",
  "#NAME?",
  "#NULL!",
  "#NUM!",
  "#REF!",
  "#VALUE!",
]);

export type SpreadsheetWorkbook = SpreadsheetEngine;

export type SpreadsheetEngineBinding = Readonly<{
  open(bytes: Uint8Array): Promise<SpreadsheetWorkbook>;
  parseRangeAddress(address: string): SpreadsheetRange;
}>;

export const defaultSpreadsheetEngineBinding: SpreadsheetEngineBinding = {
  open: (bytes) => SpreadsheetEngine.open(bytes),
  parseRangeAddress,
};

export type SpreadsheetViewerVerifier = (input: {
  bytes: Uint8Array;
  workbook: SpreadsheetWorkbook;
}) => Promise<
  Readonly<{
    diagnostics: readonly DocumentDiagnostic[];
    valid: boolean;
  }>
>;

const objectSchema = (properties: Record<string, unknown>, required: readonly string[] = []) => ({
  additionalProperties: false,
  properties,
  required,
  type: "object",
});

const rangeSchema = { pattern: "^[A-Za-z]+[1-9][0-9]*(?::[A-Za-z]+[1-9][0-9]*)?$", type: "string" };
const sheetSchema = { minLength: 1, type: "string" };
const colorSchema = { pattern: "^#[0-9A-Fa-f]{6}$", type: "string" };
const scalarSchema = {
  anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }],
};
const formulaCellSchema = objectSchema(
  {
    formula: { minLength: 1, type: "string" },
    formulaResult: scalarSchema,
  },
  ["formula"],
);
const styleSchema = objectSchema({
  background: colorSchema,
  bold: { type: "boolean" },
  borderBottom: colorSchema,
  borderLeft: colorSchema,
  borderRight: colorSchema,
  borderTop: colorSchema,
  color: colorSchema,
  fontFamily: { minLength: 1, type: "string" },
  fontSize: { exclusiveMinimum: 0, type: "number" },
  horizontal: { enum: ["left", "center", "right"] },
  italic: { type: "boolean" },
  numberFormat: { minLength: 1, type: "string" },
  underline: { type: "boolean" },
  vertical: { enum: ["top", "middle", "bottom"] },
  wrapText: { type: "boolean" },
});
const predicateSchema = objectSchema(
  {
    column: { minLength: 1, type: "string" },
    operator: {
      enum: [
        "contains",
        "ends-with",
        "equals",
        "greater-than",
        "greater-than-or-equal",
        "is-blank",
        "is-not-blank",
        "less-than",
        "less-than-or-equal",
        "not-equals",
        "starts-with",
      ],
    },
    value: scalarSchema,
  },
  ["column", "operator"],
);
const metricSchema = objectSchema(
  {
    column: { minLength: 1, type: "string" },
    name: { minLength: 1, type: "string" },
    operation: {
      enum: ["average", "count", "count-distinct", "maximum", "minimum", "sum"],
    },
  },
  ["operation"],
);
const partitionFilterSchema = objectSchema(
  {
    predicates: { items: predicateSchema, maxItems: 8, minItems: 1, type: "array" },
    quantifier: { enum: ["exists", "not-exists"] },
  },
  ["quantifier", "predicates"],
);

const commandSchemas = [
  {
    description:
      "Read workbook worksheet metadata, dimensions, merges, detected features, and anchored chart/drawing/image objects. Object anchors are occupied layout regions; do not place new content inside them.",
    inputSchema: objectSchema({}),
    mutates: false,
    name: "read_sheets_metadata",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Read sparse cell values, formulas, styles, and sheet metadata from one or more ranges.",
    inputSchema: objectSchema(
      {
        ranges: {
          items: objectSchema({ range: rangeSchema, sheetId: sheetSchema }, ["sheetId", "range"]),
          minItems: 1,
          type: "array",
        },
      },
      ["ranges"],
    ),
    mutates: false,
    name: "read_ranges",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Profile a rectangular table without returning every cell. The first row is treated as headers. Returns bounded type, blank, distinct, numeric range, and sample statistics per column.",
    inputSchema: objectSchema({ range: rangeSchema, sheetId: sheetSchema }, ["sheetId", "range"]),
    mutates: false,
    name: "profile_table",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Filter and project rows from a rectangular table with bounded output. Use partitionBy plus partitionFilters for same-entity conditions across multiple rows. Never paginate this command to reconstruct a whole table.",
    inputSchema: objectSchema(
      {
        columns: {
          items: { minLength: 1, type: "string" },
          maxItems: 50,
          minItems: 1,
          type: "array",
        },
        limit: { maximum: 200, minimum: 1, type: "integer" },
        offset: { minimum: 0, type: "integer" },
        partitionBy: { minLength: 1, type: "string" },
        partitionFilters: {
          items: partitionFilterSchema,
          maxItems: 8,
          minItems: 1,
          type: "array",
        },
        predicates: { items: predicateSchema, maxItems: 20, type: "array" },
        range: rangeSchema,
        sheetId: sheetSchema,
      },
      ["sheetId", "range"],
    ),
    mutates: false,
    name: "query_table",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Group and aggregate inside the workbook engine without serializing source rows. Use partitionBy plus partitionFilters to retain entities whose related rows satisfy exists or not-exists conditions before aggregation.",
    inputSchema: objectSchema(
      {
        groupBy: {
          items: { minLength: 1, type: "string" },
          maxItems: 3,
          type: "array",
        },
        metrics: { items: metricSchema, maxItems: 8, minItems: 1, type: "array" },
        partitionBy: { minLength: 1, type: "string" },
        partitionFilters: {
          items: partitionFilterSchema,
          maxItems: 8,
          minItems: 1,
          type: "array",
        },
        predicates: { items: predicateSchema, maxItems: 20, type: "array" },
        range: rangeSchema,
        sheetId: sheetSchema,
      },
      ["sheetId", "range", "metrics"],
    ),
    mutates: false,
    name: "aggregate_table",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Render one worksheet range as deterministic SVG from the editable workbook model.",
    inputSchema: objectSchema({ range: rangeSchema, sheetId: sheetSchema }, ["sheetId", "range"]),
    mutates: false,
    name: "read_range_image",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Write a rectangular matrix of scalar values or formula inputs beginning at one cell.",
    inputSchema: objectSchema(
      {
        start: rangeSchema,
        sheetId: sheetSchema,
        values: {
          items: {
            items: { anyOf: [scalarSchema, formulaCellSchema] },
            minItems: 1,
            type: "array",
          },
          minItems: 1,
          type: "array",
        },
      },
      ["sheetId", "start", "values"],
    ),
    mutates: true,
    name: "write_range",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Fill a range from one scalar or formula input without repeating it in the tool payload. Relative A1 references are translated from the range's top-left cell by default.",
    inputSchema: objectSchema(
      {
        input: { anyOf: [scalarSchema, formulaCellSchema] },
        range: rangeSchema,
        sheetId: sheetSchema,
        translateFormula: { type: "boolean" },
      },
      ["sheetId", "range", "input"],
    ),
    mutates: true,
    name: "fill_range",
    outputSchema: { type: "object" },
  },
  {
    description: "Resize or hide a contiguous row or column interval.",
    inputSchema: objectSchema(
      {
        axis: { enum: ["rows", "columns"] },
        end: { minimum: 1, type: "integer" },
        hidden: { type: "boolean" },
        sheetId: sheetSchema,
        size: { minimum: 0, type: "number" },
        start: { minimum: 1, type: "integer" },
      },
      ["sheetId", "axis", "start", "end"],
    ),
    mutates: true,
    name: "resize_range",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Apply supported typography, background color, borders, alignment, and number formatting to a range. Use background (not fill) for cell color.",
    inputSchema: objectSchema({ range: rangeSchema, sheetId: sheetSchema, style: styleSchema }, [
      "sheetId",
      "range",
      "style",
    ]),
    mutates: true,
    name: "format_range",
    outputSchema: { type: "object" },
  },
  {
    description: "Merge a non-overlapping rectangular cell range.",
    inputSchema: objectSchema({ range: rangeSchema, sheetId: sheetSchema }, ["sheetId", "range"]),
    mutates: true,
    name: "merge_cells",
    outputSchema: { type: "object" },
  },
  {
    description: "Create a worksheet at an optional zero-based workbook position.",
    inputSchema: objectSchema(
      {
        name: { maxLength: 31, minLength: 1, type: "string" },
        position: { minimum: 0, type: "integer" },
      },
      ["name"],
    ),
    mutates: true,
    name: "create_sheet",
    outputSchema: { type: "object" },
  },
  {
    description: "Rename a worksheet and rewrite direct cross-sheet formula references.",
    inputSchema: objectSchema({ name: sheetSchema, sheetId: sheetSchema }, ["sheetId", "name"]),
    mutates: true,
    name: "rename_sheet",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Delete a worksheet and its owned OOXML package parts. A final worksheet cannot be deleted.",
    inputSchema: objectSchema({ sheetId: sheetSchema }, ["sheetId"]),
    mutates: true,
    name: "delete_sheet",
    outputSchema: { type: "object" },
  },
  {
    description: "Move a worksheet to a zero-based workbook position.",
    inputSchema: objectSchema({ position: { minimum: 0, type: "integer" }, sheetId: sheetSchema }, [
      "sheetId",
      "position",
    ]),
    mutates: true,
    name: "move_sheet",
    outputSchema: { type: "object" },
  },
  {
    description: "Show or hide a worksheet while preserving at least one visible sheet.",
    inputSchema: objectSchema({ hidden: { type: "boolean" }, sheetId: sheetSchema }, [
      "sheetId",
      "hidden",
    ]),
    mutates: true,
    name: "set_sheet_visibility",
    outputSchema: { type: "object" },
  },
  {
    description: "Create a native Excel bar, column, line, or pie chart anchored to a cell range.",
    inputSchema: objectSchema(
      {
        anchor: rangeSchema,
        categoryRange: rangeSchema,
        legend: { enum: ["bottom", "left", "none", "right", "top"] },
        name: { minLength: 1, type: "string" },
        sheetId: sheetSchema,
        sourceSheetId: sheetSchema,
        title: { type: "string" },
        type: { enum: ["bar", "column", "line", "pie"] },
        valueRange: rangeSchema,
      },
      ["sheetId", "type", "anchor", "categoryRange", "valueRange"],
    ),
    mutates: true,
    name: "create_chart",
    outputSchema: { type: "object" },
  },
  {
    description: "Add a native duplicate, unique, or cell comparison conditional-formatting rule.",
    inputSchema: objectSchema(
      {
        formula: scalarSchema,
        kind: { enum: ["duplicate-values", "unique-values", "cell-is"] },
        operator: {
          enum: [
            "equal",
            "greater-than",
            "greater-than-or-equal",
            "less-than",
            "less-than-or-equal",
            "not-equal",
          ],
        },
        range: rangeSchema,
        sheetId: sheetSchema,
        style: styleSchema,
      },
      ["sheetId", "range", "kind", "style"],
    ),
    mutates: true,
    name: "add_conditional_format",
    outputSchema: { type: "object" },
  },
  {
    description: "Add native Excel list validation from inline values or a workbook range formula.",
    inputSchema: objectSchema(
      {
        allowBlank: { type: "boolean" },
        error: { type: "string" },
        formula: { minLength: 1, type: "string" },
        range: rangeSchema,
        sheetId: sheetSchema,
        values: { items: { type: "string" }, maxItems: 100, minItems: 1, type: "array" },
      },
      ["sheetId", "range"],
    ),
    mutates: true,
    name: "add_validation_list",
    outputSchema: { type: "object" },
  },
  {
    description: "Promote a rectangular range with headers to a native structured Excel table.",
    inputSchema: objectSchema(
      { name: sheetSchema, range: rangeSchema, sheetId: sheetSchema, style: { type: "string" } },
      ["sheetId", "range", "name"],
    ),
    mutates: true,
    name: "create_table",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Create a native refreshable Excel PivotTable/TCD and materialize its current summary.",
    inputSchema: objectSchema(
      {
        name: sheetSchema,
        rowFields: { items: sheetSchema, maxItems: 3, minItems: 1, type: "array" },
        sourceRange: rangeSchema,
        sourceSheetId: sheetSchema,
        target: rangeSchema,
        targetSheetId: sheetSchema,
        values: {
          items: objectSchema(
            {
              field: sheetSchema,
              name: sheetSchema,
              summarizeBy: { enum: ["average", "count", "maximum", "minimum", "sum"] },
            },
            ["field", "summarizeBy"],
          ),
          maxItems: 8,
          minItems: 1,
          type: "array",
        },
      },
      ["sourceSheetId", "sourceRange", "targetSheetId", "target", "name", "rowFields", "values"],
    ),
    mutates: true,
    name: "create_pivot_table",
    outputSchema: { type: "object" },
  },
  {
    description:
      "Recalculate supported formulas and report any formulas that require a more capable evaluator.",
    inputSchema: objectSchema({}),
    mutates: true,
    name: "recalculate",
    outputSchema: { type: "object" },
  },
  {
    description: "Export, reopen, and structurally verify the current workbook candidate.",
    inputSchema: objectSchema({}),
    mutates: false,
    name: "verify_workbook",
    outputSchema: { type: "object" },
  },
] as const satisfies readonly DocumentCommandSchema[];

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${label} must be a string.`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function boundedRange(
  binding: SpreadsheetEngineBinding,
  value: unknown,
  maximumCells: number,
): SpreadsheetRange {
  const parsed = binding.parseRangeAddress(string(value, "range"));
  const count = (parsed.bottom - parsed.top + 1) * (parsed.right - parsed.left + 1);
  if (count > maximumCells) throw new Error(`Range exceeds ${maximumCells} cells.`);
  return parsed;
}

function range(binding: SpreadsheetEngineBinding, value: unknown): SpreadsheetRange {
  return boundedRange(binding, value, MAX_RANGE_CELLS);
}

function tableRange(binding: SpreadsheetEngineBinding, value: unknown): SpreadsheetRange {
  return boundedRange(binding, value, MAX_TABLE_CELLS);
}

function scalar(value: unknown): SpreadsheetScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new TypeError("Cell values must be strings, finite numbers, booleans, or null.");
}

function optionalStrings(value: unknown, label: string, maximum: number): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be an array with at most ${maximum} items.`);
  }
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

const PREDICATE_OPERATORS = new Set<SpreadsheetTablePredicate["operator"]>([
  "contains",
  "ends-with",
  "equals",
  "greater-than",
  "greater-than-or-equal",
  "is-blank",
  "is-not-blank",
  "less-than",
  "less-than-or-equal",
  "not-equals",
  "starts-with",
]);

function predicates(
  value: unknown,
  label = "predicates",
  maximum = 20,
): readonly SpreadsheetTablePredicate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be an array with at most ${maximum} items.`);
  }
  return value.map((item, index) => {
    const predicate = record(item, `${label}[${index}]`);
    if (
      typeof predicate.operator !== "string" ||
      !PREDICATE_OPERATORS.has(predicate.operator as SpreadsheetTablePredicate["operator"])
    ) {
      throw new TypeError(`${label}[${index}].operator is unsupported.`);
    }
    return {
      column: string(predicate.column, `${label}[${index}].column`),
      operator: predicate.operator as SpreadsheetTablePredicate["operator"],
      ...("value" in predicate ? { value: scalar(predicate.value) } : {}),
    };
  });
}

function partitionFilters(value: unknown): readonly SpreadsheetTablePartitionFilter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new TypeError("partitionFilters must contain between 1 and 8 items.");
  }
  return value.map((item, index) => {
    const filter = record(item, `partitionFilters[${index}]`);
    if (filter.quantifier !== "exists" && filter.quantifier !== "not-exists") {
      throw new TypeError(`partitionFilters[${index}].quantifier is unsupported.`);
    }
    const nested = predicates(filter.predicates, `partitionFilters[${index}].predicates`, 8);
    if (nested.length === 0) {
      throw new TypeError(`partitionFilters[${index}].predicates must not be empty.`);
    }
    return { predicates: nested, quantifier: filter.quantifier };
  });
}

const AGGREGATE_OPERATIONS = new Set<SpreadsheetTableAggregateMetric["operation"]>([
  "average",
  "count",
  "count-distinct",
  "maximum",
  "minimum",
  "sum",
]);

function metrics(value: unknown): readonly SpreadsheetTableAggregateMetric[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new TypeError("metrics must contain between 1 and 8 items.");
  }
  return value.map((item, index) => {
    const metric = record(item, `metrics[${index}]`);
    if (
      typeof metric.operation !== "string" ||
      !AGGREGATE_OPERATIONS.has(metric.operation as SpreadsheetTableAggregateMetric["operation"])
    ) {
      throw new TypeError(`metrics[${index}].operation is unsupported.`);
    }
    return {
      ...(metric.column === undefined
        ? {}
        : { column: string(metric.column, `metrics[${index}].column`) }),
      ...(metric.name === undefined ? {} : { name: string(metric.name, `metrics[${index}].name`) }),
      operation: metric.operation as SpreadsheetTableAggregateMetric["operation"],
    };
  });
}

function cellInput(value: unknown): SpreadsheetCellInput | SpreadsheetScalar {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return scalar(value);
  const input = record(value, "formula cell");
  const unknownKey = Object.keys(input).find(
    (key) => key !== "formula" && key !== "formulaResult" && key !== "value",
  );
  if (unknownKey) throw new TypeError(`Unsupported cell input property: ${unknownKey}.`);
  if ("formula" in input && "value" in input) {
    throw new TypeError("Cell objects cannot contain both formula and value.");
  }
  if ("formulaResult" in input && !("formula" in input)) {
    throw new TypeError("formulaResult requires formula.");
  }
  const result: { formula?: string; formulaResult?: SpreadsheetScalar; value?: SpreadsheetScalar } =
    {};
  if ("formula" in input) result.formula = string(input.formula, "formula");
  if ("formulaResult" in input) result.formulaResult = scalar(input.formulaResult);
  if ("value" in input) result.value = scalar(input.value);
  if (!("formula" in result) && !("value" in result)) {
    throw new TypeError("Cell objects require a formula or value.");
  }
  return result;
}

function cellStyle(value: unknown): SpreadsheetCellStyle {
  const source = record(value, "style");
  const result: Record<string, unknown> = {};
  const booleanKeys = ["bold", "italic", "underline", "wrapText"] as const;
  const stringKeys = ["fontFamily", "numberFormat"] as const;
  const colorKeys = [
    "background",
    "borderBottom",
    "borderLeft",
    "borderRight",
    "borderTop",
    "color",
  ] as const;
  const supportedKeys = new Set([
    ...booleanKeys,
    ...stringKeys,
    ...colorKeys,
    "fontSize",
    "horizontal",
    "vertical",
  ]);
  const unknownKey = Object.keys(source).find((key) => !supportedKeys.has(key));
  if (unknownKey) throw new TypeError(`Unsupported style property: ${unknownKey}.`);
  for (const key of booleanKeys) {
    if (key in source) {
      if (typeof source[key] !== "boolean") throw new TypeError(`${key} must be a boolean.`);
      result[key] = source[key];
    }
  }
  for (const key of stringKeys) {
    if (key in source) result[key] = string(source[key], key);
  }
  for (const key of colorKeys) {
    if (!(key in source)) continue;
    const value = string(source[key], key);
    if (!/^#[\dA-F]{6}$/iu.test(value))
      throw new TypeError(`${key} must be a six-digit hex color.`);
    result[key] = value;
  }
  if ("fontSize" in source) {
    if (
      typeof source.fontSize !== "number" ||
      !Number.isFinite(source.fontSize) ||
      source.fontSize <= 0
    ) {
      throw new TypeError("fontSize must be a positive finite number.");
    }
    result.fontSize = source.fontSize;
  }
  if ("horizontal" in source) {
    if (
      source.horizontal !== "left" &&
      source.horizontal !== "center" &&
      source.horizontal !== "right"
    ) {
      throw new TypeError("horizontal must be left, center, or right.");
    }
    result.horizontal = source.horizontal;
  }
  if ("vertical" in source) {
    if (source.vertical !== "top" && source.vertical !== "middle" && source.vertical !== "bottom") {
      throw new TypeError("vertical must be top, middle, or bottom.");
    }
    result.vertical = source.vertical;
  }
  return result as SpreadsheetCellStyle;
}

function engineDiagnostic(diagnostic: SpreadsheetDiagnostic): DocumentDiagnostic {
  return {
    code: diagnostic.code,
    ...(diagnostic.part || diagnostic.sheetId
      ? {
          location: {
            ...(diagnostic.part ? { part: diagnostic.part } : {}),
            ...(diagnostic.sheetId ? { sheetId: diagnostic.sheetId } : {}),
          },
        }
      : {}),
    message: diagnostic.message,
    severity: diagnostic.severity,
  };
}

function axisMetadata(axis: SpreadsheetWorkbook["model"]["sheets"][number]["rows"]) {
  return {
    defaultSize: axis.defaultSize,
    hidden: [...axis.hidden].sort((left, right) => left - right),
    sizes: [...axis.sizes]
      .sort(([left], [right]) => left - right)
      .map(([index, size]) => ({ index, size })),
  };
}

function formulaDiagnostics(
  workbook: SpreadsheetWorkbook,
  evaluationConfirmed: boolean,
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  let formulaCount = 0;
  for (const sheet of workbook.model.sheets) {
    for (const cell of sheet.cells.values()) {
      if (!cell.formula) continue;
      formulaCount += 1;
      if (typeof cell.formulaResult === "string" && FORMULA_ERRORS.has(cell.formulaResult)) {
        diagnostics.push({
          code: "xlsx.formula.cached_error",
          location: { cell: cell.address, sheetId: sheet.id },
          message: `Formula ${sheet.name}!${cell.address} has cached error ${cell.formulaResult}.`,
          severity: "error",
        });
      }
    }
  }
  if (formulaCount > 0 && !evaluationConfirmed) {
    diagnostics.push({
      code: "xlsx.formula.evaluation_deferred",
      message: `${formulaCount} formula(s) were inspected, but this engine does not evaluate formulas. Compatible spreadsheet software will recalculate formulas on open.`,
      severity: "warning",
    });
  }
  return diagnostics;
}

export class SpreadsheetDocumentEngine implements DocumentFormatEngine<SpreadsheetWorkbook> {
  readonly binding: SpreadsheetEngineBinding;
  readonly #recalculated = new WeakMap<SpreadsheetWorkbook, readonly DocumentDiagnostic[]>();
  readonly viewerVerifier: SpreadsheetViewerVerifier | undefined;
  readonly descriptor = {
    commands: commandSchemas,
    engineVersion: "anydoc-spreadsheet-1",
    features: {
      charts: { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      cells: { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      "conditional-formatting": {
        inspect: true,
        mutate: true,
        render: "native",
        roundTrip: "preserve",
      },
      "data-validation": {
        inspect: true,
        mutate: true,
        render: "native",
        roundTrip: "preserve",
      },
      formulas: { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      merges: { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      "pivot-tables": { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      styles: { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      tables: { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      worksheets: { inspect: true, mutate: true, render: "native", roundTrip: "preserve" },
      "unknown-ooxml": {
        inspect: true,
        mutate: false,
        render: "placeholder",
        roundTrip: "preserve",
      },
    },
    format: "xlsx",
    mediaTypes: [XLSX_MEDIA_TYPE],
  } as const;

  constructor(
    binding: SpreadsheetEngineBinding = defaultSpreadsheetEngineBinding,
    viewerVerifier?: SpreadsheetViewerVerifier,
  ) {
    this.binding = binding;
    this.viewerVerifier = viewerVerifier;
  }

  async open(input: { bytes: Uint8Array }): Promise<SpreadsheetWorkbook> {
    return await this.binding.open(input.bytes);
  }

  async close(): Promise<void> {}

  async execute(input: { arguments: unknown; command: string; state: SpreadsheetWorkbook }) {
    const args = record(input.arguments, `${input.command} arguments`);
    if (input.command === "read_sheets_metadata") {
      return {
        changed: false,
        result: {
          diagnostics: input.state.model.diagnostics,
          features: input.state.model.features,
          objects: input.state.model.objects,
          sheets: input.state.model.sheets.map((sheet) => ({
            columns: axisMetadata(sheet.columns),
            conditionalFormats: sheet.conditionalFormats,
            dataValidations: sheet.dataValidations,
            frozenColumns: sheet.frozenColumns,
            frozenRows: sheet.frozenRows,
            hidden: sheet.hidden,
            id: sheet.id,
            merges: sheet.merges,
            name: sheet.name,
            pivotTables: sheet.pivotTables,
            rows: axisMetadata(sheet.rows),
            showGridLines: sheet.showGridLines,
            tables: sheet.tables,
            usedRange: sheet.usedRange,
          })),
        },
        state: input.state,
      };
    }
    if (input.command === "read_ranges") {
      if (!Array.isArray(args.ranges) || args.ranges.length === 0) {
        throw new TypeError("ranges must be a non-empty array.");
      }
      return {
        changed: false,
        result: {
          ranges: args.ranges.map((item) => {
            const requested = record(item, "range request");
            return input.state.inspect(
              string(requested.sheetId, "sheetId"),
              range(this.binding, requested.range),
            );
          }),
        },
        state: input.state,
      };
    }
    if (input.command === "profile_table") {
      return {
        changed: false,
        result: input.state.profileTable(
          string(args.sheetId, "sheetId"),
          tableRange(this.binding, args.range),
        ),
        state: input.state,
      };
    }
    if (input.command === "query_table") {
      const offset =
        args.offset === undefined ? undefined : nonNegativeInteger(args.offset, "offset");
      const limit = args.limit === undefined ? undefined : integer(args.limit, "limit");
      return {
        changed: false,
        result: input.state.queryTable({
          ...(args.columns === undefined
            ? {}
            : { columns: optionalStrings(args.columns, "columns", 50) }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
          ...(args.partitionBy === undefined
            ? {}
            : { partitionBy: string(args.partitionBy, "partitionBy") }),
          partitionFilters: partitionFilters(args.partitionFilters),
          predicates: predicates(args.predicates),
          range: tableRange(this.binding, args.range),
          sheetId: string(args.sheetId, "sheetId"),
        }),
        state: input.state,
      };
    }
    if (input.command === "aggregate_table") {
      return {
        changed: false,
        result: input.state.aggregateTable({
          groupBy: optionalStrings(args.groupBy, "groupBy", 3),
          metrics: metrics(args.metrics),
          ...(args.partitionBy === undefined
            ? {}
            : { partitionBy: string(args.partitionBy, "partitionBy") }),
          partitionFilters: partitionFilters(args.partitionFilters),
          predicates: predicates(args.predicates),
          range: tableRange(this.binding, args.range),
          sheetId: string(args.sheetId, "sheetId"),
        }),
        state: input.state,
      };
    }
    if (input.command === "read_range_image") {
      const target = range(this.binding, args.range);
      return {
        changed: false,
        result: {
          data: input.state.renderRange(string(args.sheetId, "sheetId"), target),
          mediaType: "image/svg+xml",
          range: args.range,
          sheetId: args.sheetId,
        },
        state: input.state,
      };
    }
    if (input.command === "write_range") {
      const start = range(this.binding, args.start);
      if (start.top !== start.bottom || start.left !== start.right) {
        throw new TypeError("write_range start must identify one cell.");
      }
      if (!Array.isArray(args.values) || args.values.length === 0) {
        throw new TypeError("values must be a non-empty matrix.");
      }
      let width: number | null = null;
      const cells = args.values.map((row, index) => {
        if (!Array.isArray(row) || row.length === 0) {
          throw new TypeError(`values[${index}] must be a non-empty array.`);
        }
        width ??= row.length;
        if (row.length !== width) throw new TypeError("values must be a rectangular matrix.");
        return row.map(cellInput);
      });
      input.state.apply({
        cells,
        column: start.left,
        kind: "write-range",
        row: start.top,
        sheetId: string(args.sheetId, "sheetId"),
      });
      return { changed: true, result: { writtenRows: cells.length }, state: input.state };
    }
    if (input.command === "fill_range") {
      const target = range(this.binding, args.range);
      input.state.apply({
        input: cellInput(args.input),
        kind: "fill-range",
        range: target,
        sheetId: string(args.sheetId, "sheetId"),
        translateFormula: args.translateFormula !== false,
      });
      return {
        changed: true,
        result: {
          filledCells: (target.bottom - target.top + 1) * (target.right - target.left + 1),
        },
        state: input.state,
      };
    }
    if (input.command === "resize_range") {
      if ("hidden" in args && typeof args.hidden !== "boolean") {
        throw new TypeError("hidden must be a boolean.");
      }
      if (
        "size" in args &&
        (typeof args.size !== "number" || !Number.isFinite(args.size) || args.size < 0)
      ) {
        throw new TypeError("size must be a non-negative finite number.");
      }
      const operation: SpreadsheetOperation = {
        axis:
          args.axis === "rows" || args.axis === "columns"
            ? args.axis
            : (() => {
                throw new TypeError("axis must be rows or columns.");
              })(),
        end: integer(args.end, "end"),
        ...(typeof args.hidden === "boolean" ? { hidden: args.hidden } : {}),
        kind: "resize",
        sheetId: string(args.sheetId, "sheetId"),
        ...(typeof args.size === "number" ? { size: args.size } : {}),
        start: integer(args.start, "start"),
      };
      input.state.apply(operation);
      return { changed: true, result: { resized: true }, state: input.state };
    }
    if (input.command === "format_range") {
      input.state.apply({
        kind: "format-range",
        range: range(this.binding, args.range),
        sheetId: string(args.sheetId, "sheetId"),
        style: cellStyle(args.style),
      });
      return { changed: true, result: { formatted: true }, state: input.state };
    }
    if (input.command === "merge_cells") {
      input.state.apply({
        kind: "merge",
        range: range(this.binding, args.range),
        sheetId: string(args.sheetId, "sheetId"),
      });
      return { changed: true, result: { merged: true }, state: input.state };
    }
    if (input.command === "create_sheet") {
      input.state.apply({
        kind: "create-sheet",
        name: string(args.name, "name"),
        ...(args.position === undefined
          ? {}
          : { position: nonNegativeInteger(args.position, "position") }),
      });
      const sheet = input.state.model.sheets.find(
        ({ name }) => name === string(args.name, "name").trim(),
      );
      return { changed: true, result: { sheet }, state: input.state };
    }
    if (input.command === "rename_sheet") {
      input.state.apply({
        kind: "rename-sheet",
        name: string(args.name, "name"),
        sheetId: string(args.sheetId, "sheetId"),
      });
      return { changed: true, result: { renamed: true }, state: input.state };
    }
    if (input.command === "delete_sheet") {
      input.state.apply({ kind: "delete-sheet", sheetId: string(args.sheetId, "sheetId") });
      return { changed: true, result: { deleted: true }, state: input.state };
    }
    if (input.command === "move_sheet") {
      input.state.apply({
        kind: "move-sheet",
        position: nonNegativeInteger(args.position, "position"),
        sheetId: string(args.sheetId, "sheetId"),
      });
      return { changed: true, result: { moved: true }, state: input.state };
    }
    if (input.command === "set_sheet_visibility") {
      if (typeof args.hidden !== "boolean") throw new TypeError("hidden must be a boolean.");
      input.state.apply({
        hidden: args.hidden,
        kind: "set-sheet-visibility",
        sheetId: string(args.sheetId, "sheetId"),
      });
      return { changed: true, result: { hidden: args.hidden }, state: input.state };
    }
    if (input.command === "create_chart") {
      const anchor = range(this.binding, args.anchor);
      const type = args.type;
      if (type !== "bar" && type !== "column" && type !== "line" && type !== "pie")
        throw new TypeError("type must be bar, column, line, or pie.");
      const legend = args.legend ?? "right";
      if (
        legend !== "bottom" &&
        legend !== "left" &&
        legend !== "none" &&
        legend !== "right" &&
        legend !== "top"
      )
        throw new TypeError("legend is unsupported.");
      input.state.apply({
        anchor: {
          from: {
            column: anchor.left,
            columnOffsetEmu: 0,
            row: anchor.top,
            rowOffsetEmu: 0,
          },
          kind: "two-cell",
          to: {
            column: anchor.right,
            columnOffsetEmu: 0,
            row: anchor.bottom,
            rowOffsetEmu: 0,
          },
        },
        chart: {
          legend,
          series: [
            {
              categoryRange: string(args.categoryRange, "categoryRange"),
              ...(args.name === undefined ? {} : { name: string(args.name, "name") }),
              ...(args.sourceSheetId === undefined
                ? {}
                : { sourceSheetId: string(args.sourceSheetId, "sourceSheetId") }),
              valueRange: string(args.valueRange, "valueRange"),
            },
          ],
          ...(args.title === undefined ? {} : { title: String(args.title) }),
          type,
        },
        kind: "create-chart",
        sheetId: string(args.sheetId, "sheetId"),
      });
      return { changed: true, result: { created: true }, state: input.state };
    }
    if (input.command === "add_conditional_format") {
      const kind = args.kind;
      const target = range(this.binding, args.range);
      const style = cellStyle(args.style);
      const sheetId = string(args.sheetId, "sheetId");
      if (kind === "duplicate-values" || kind === "unique-values") {
        input.state.apply({
          kind: "add-conditional-format",
          rule: { kind, range: target, style },
          sheetId,
        });
      } else if (kind === "cell-is") {
        const operator = args.operator;
        if (
          operator !== "equal" &&
          operator !== "greater-than" &&
          operator !== "greater-than-or-equal" &&
          operator !== "less-than" &&
          operator !== "less-than-or-equal" &&
          operator !== "not-equal"
        )
          throw new TypeError("operator is required for cell-is rules.");
        input.state.apply({
          kind: "add-conditional-format",
          rule: {
            formula: scalar(args.formula),
            kind,
            operator,
            range: target,
            style,
          },
          sheetId,
        });
      } else {
        throw new TypeError("kind is unsupported.");
      }
      return { changed: true, result: { created: true }, state: input.state };
    }
    if (input.command === "add_validation_list") {
      const values = optionalStrings(args.values, "values", 100);
      if (values.length > 0 === (args.formula !== undefined))
        throw new TypeError("Provide exactly one of values or formula.");
      input.state.apply({
        kind: "add-data-validation",
        rule: {
          allowBlank: args.allowBlank !== false,
          ...(args.error === undefined ? {} : { error: String(args.error) }),
          range: range(this.binding, args.range),
          source:
            values.length > 0
              ? { kind: "values", values }
              : { formula: string(args.formula, "formula"), kind: "range" },
        },
        sheetId: string(args.sheetId, "sheetId"),
      });
      return { changed: true, result: { created: true }, state: input.state };
    }
    if (input.command === "create_table") {
      input.state.apply({
        kind: "create-table",
        name: string(args.name, "name"),
        range: tableRange(this.binding, args.range),
        sheetId: string(args.sheetId, "sheetId"),
        ...(args.style === undefined ? {} : { style: string(args.style, "style") }),
      });
      return { changed: true, result: { created: true }, state: input.state };
    }
    if (input.command === "create_pivot_table") {
      if (!Array.isArray(args.values) || args.values.length === 0 || args.values.length > 8)
        throw new TypeError("values must contain between 1 and 8 metrics.");
      const values: Extract<SpreadsheetOperation, { kind: "create-pivot-table" }>["values"] =
        args.values.map((value, index) => {
          const metric = record(value, `values[${index}]`);
          const summarizeBy = metric.summarizeBy;
          if (
            summarizeBy !== "average" &&
            summarizeBy !== "count" &&
            summarizeBy !== "maximum" &&
            summarizeBy !== "minimum" &&
            summarizeBy !== "sum"
          )
            throw new TypeError(`values[${index}].summarizeBy is unsupported.`);
          return {
            field: string(metric.field, `values[${index}].field`),
            ...(metric.name === undefined
              ? {}
              : { name: string(metric.name, `values[${index}].name`) }),
            summarizeBy: summarizeBy as "average" | "count" | "maximum" | "minimum" | "sum",
          };
        });
      input.state.apply({
        kind: "create-pivot-table",
        name: string(args.name, "name"),
        rowFields: optionalStrings(args.rowFields, "rowFields", 3),
        sourceRange: tableRange(this.binding, args.sourceRange),
        sourceSheetId: string(args.sourceSheetId, "sourceSheetId"),
        targetRange: range(this.binding, args.target),
        targetSheetId: string(args.targetSheetId, "targetSheetId"),
        values,
      });
      return { changed: true, result: { created: true }, state: input.state };
    }
    if (input.command === "recalculate") {
      if (input.state.recalculate) {
        const recalculation = await input.state.recalculate();
        const diagnostics = recalculation.diagnostics.map(engineDiagnostic);
        this.#recalculated.set(input.state, diagnostics);
        return {
          changed: recalculation.evaluatedCells > 0,
          diagnostics,
          result: { ...recalculation, evaluated: true },
          state: input.state,
        };
      }
      const diagnostic = {
        code: "xlsx.formula.evaluation_unsupported",
        message:
          "AnyDoc preserves formulas and requests recalculation on open, but this engine does not evaluate formulas yet.",
        severity: "warning" as const,
      };
      return {
        changed: false,
        diagnostics: [diagnostic],
        result: { evaluated: false, mode: "deferred-to-compatible-host" },
        state: input.state,
      };
    }
    if (input.command === "verify_workbook") {
      const verification = await input.state.verify();
      return {
        changed: false,
        diagnostics: verification.diagnostics.map(engineDiagnostic),
        result: verification,
        state: input.state,
      };
    }
    throw new Error(`Unsupported spreadsheet command: ${input.command}`);
  }

  async export(state: SpreadsheetWorkbook): Promise<Uint8Array> {
    return await state.export();
  }

  async verify(input: {
    bytes: Uint8Array;
    state: SpreadsheetWorkbook;
  }): Promise<DocumentEngineVerification> {
    const reopened = await this.binding.open(input.bytes);
    const structural = await input.state.verify();
    const diagnostics = structural.diagnostics.map(engineDiagnostic);
    const recalculationDiagnostics = this.#recalculated.get(input.state);
    const formulaIssues = formulaDiagnostics(reopened, recalculationDiagnostics !== undefined);
    diagnostics.push(...formulaIssues);
    if (recalculationDiagnostics) diagnostics.push(...recalculationDiagnostics);
    const renderArtifacts: Array<{ bytes: Uint8Array; region: string; surfaceId: string }> = [];
    try {
      for (const sheet of reopened.model.sheets) {
        const target = sheet.usedRange ?? { bottom: 1, left: 1, right: 1, top: 1 };
        renderArtifacts.push({
          bytes: new TextEncoder().encode(reopened.renderRange(sheet.id, target)),
          region: `${target.top}:${target.left}:${target.bottom}:${target.right}`,
          surfaceId: sheet.id,
        });
      }
    } catch (error) {
      diagnostics.push({
        code: "xlsx.visual_render",
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
      });
    }
    const viewer = this.viewerVerifier
      ? await this.viewerVerifier({ bytes: input.bytes, workbook: reopened })
      : {
          diagnostics: [
            {
              code: "xlsx.viewer_verification_unavailable",
              message: "No AnyDoc viewer verifier is connected to the spreadsheet document engine.",
              severity: "error" as const,
            },
          ],
          valid: false,
        };
    diagnostics.push(...viewer.diagnostics);
    const cachedFormulaError = [...formulaIssues, ...(recalculationDiagnostics ?? [])].some(
      ({ severity }) => severity === "error",
    );
    const hasFormula = reopened.model.sheets.some((sheet) =>
      [...sheet.cells.values()].some((cell) => Boolean(cell.formula)),
    );
    return {
      checks: {
        engineRoundTrip: structural.valid ? "passed" : "failed",
        formulas: cachedFormulaError
          ? "failed"
          : hasFormula && recalculationDiagnostics === undefined
            ? "not-applicable"
            : "passed",
        package: structural.valid ? "passed" : "failed",
        viewerCompatibility: viewer.valid ? "passed" : "failed",
        visualRender: diagnostics.some(
          ({ code, severity }) => code === "xlsx.visual_render" && severity === "error",
        )
          ? "failed"
          : "passed",
      },
      diagnostics,
      renderArtifacts,
    };
  }
}
