export type SpreadsheetScalar = string | number | boolean | null;

export type SpreadsheetProjectedValue =
  | SpreadsheetScalar
  | Readonly<{ displayValue: string; value: Exclude<SpreadsheetScalar, null> }>;

export type SpreadsheetColor = `#${string}`;

export type SpreadsheetCellStyle = Readonly<{
  background?: SpreadsheetColor;
  bold?: boolean;
  borderBottom?: SpreadsheetColor;
  borderLeft?: SpreadsheetColor;
  borderRight?: SpreadsheetColor;
  borderTop?: SpreadsheetColor;
  color?: SpreadsheetColor;
  fontFamily?: string;
  fontSize?: number;
  horizontal?: "center" | "left" | "right";
  italic?: boolean;
  numberFormat?: string;
  underline?: boolean;
  vertical?: "bottom" | "middle" | "top";
  wrapText?: boolean;
}>;

export type SpreadsheetCell = Readonly<{
  address: string;
  column: number;
  displayValue: string;
  formula?: string;
  formulaResult?: SpreadsheetScalar;
  hyperlink?: SpreadsheetHyperlink;
  row: number;
  style: SpreadsheetCellStyle;
  value: SpreadsheetScalar;
}>;

export type SpreadsheetHyperlink = Readonly<{
  kind: "external" | "internal";
  target: string;
  tooltip?: string;
}>;

export type SpreadsheetAnchorPoint = Readonly<{
  column: number;
  columnOffsetEmu: number;
  row: number;
  rowOffsetEmu: number;
}>;

export type SpreadsheetObjectAnchor =
  | Readonly<{
      from: SpreadsheetAnchorPoint;
      kind: "one-cell";
      size: Readonly<{ heightEmu: number; widthEmu: number }>;
    }>
  | Readonly<{
      from: SpreadsheetAnchorPoint;
      kind: "two-cell";
      to: SpreadsheetAnchorPoint;
    }>
  | Readonly<{
      kind: "absolute";
      position: Readonly<{ xEmu: number; yEmu: number }>;
      size: Readonly<{ heightEmu: number; widthEmu: number }>;
    }>;

export type SpreadsheetObject = Readonly<{
  anchor?: SpreadsheetObjectAnchor;
  chart?: SpreadsheetChart;
  id: string;
  kind: "chart" | "drawing" | "image";
  name?: string;
  relationshipTarget: string;
  sheetId: string;
}>;

export type SpreadsheetChartType = "bar" | "column" | "line" | "pie";

export type SpreadsheetChartSeries = Readonly<{
  categoryRange: string;
  name?: string;
  sourceSheetId?: string;
  sourceSheetName?: string;
  valueRange: string;
}>;

export type SpreadsheetChart = Readonly<{
  id: string;
  legend: "bottom" | "left" | "none" | "right" | "top";
  series: ReadonlyArray<SpreadsheetChartSeries>;
  title?: string;
  type: SpreadsheetChartType;
}>;

export type SpreadsheetConditionalFormat =
  | Readonly<{
      id: string;
      kind: "duplicate-values" | "unique-values";
      range: SpreadsheetRange;
      style: SpreadsheetCellStyle;
    }>
  | Readonly<{
      formula: SpreadsheetScalar;
      id: string;
      kind: "cell-is";
      operator:
        | "equal"
        | "greater-than"
        | "greater-than-or-equal"
        | "less-than"
        | "less-than-or-equal"
        | "not-equal";
      range: SpreadsheetRange;
      style: SpreadsheetCellStyle;
    }>;

export type SpreadsheetConditionalFormatInput = SpreadsheetConditionalFormat extends infer Rule
  ? Rule extends SpreadsheetConditionalFormat
    ? Omit<Rule, "id"> & { id?: string }
    : never
  : never;

export type SpreadsheetDataValidation = Readonly<{
  allowBlank: boolean;
  error?: string;
  errorTitle?: string;
  id: string;
  prompt?: string;
  promptTitle?: string;
  range: SpreadsheetRange;
  source: Readonly<
    { kind: "range"; formula: string } | { kind: "values"; values: readonly string[] }
  >;
}>;

export type SpreadsheetTable = Readonly<{
  columns: ReadonlyArray<string>;
  id: string;
  name: string;
  range: SpreadsheetRange;
  showFilterButtons: boolean;
  style: string;
}>;

export type SpreadsheetPivotValue = Readonly<{
  field: string;
  name?: string;
  summarizeBy: "average" | "count" | "maximum" | "minimum" | "sum";
}>;

export type SpreadsheetPivotTable = Readonly<{
  columnField?: string;
  id: string;
  name: string;
  rowFields: ReadonlyArray<string>;
  sourceRange: SpreadsheetRange;
  sourceSheetId: string;
  targetRange: SpreadsheetRange;
  values: ReadonlyArray<SpreadsheetPivotValue>;
}>;

export type SpreadsheetMerge = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}>;

export type SpreadsheetRange = SpreadsheetMerge;

export type SpreadsheetAxis = Readonly<{
  defaultSize: number;
  hidden: ReadonlySet<number>;
  sizes: ReadonlyMap<number, number>;
}>;

export type SpreadsheetSheet = Readonly<{
  cells: ReadonlyMap<string, SpreadsheetCell>;
  conditionalFormats: ReadonlyArray<SpreadsheetConditionalFormat>;
  columns: SpreadsheetAxis;
  dataValidations: ReadonlyArray<SpreadsheetDataValidation>;
  frozenColumns: number;
  frozenRows: number;
  hidden: boolean;
  id: string;
  merges: ReadonlyArray<SpreadsheetMerge>;
  name: string;
  objects: ReadonlyArray<SpreadsheetObject>;
  pivotTables: ReadonlyArray<SpreadsheetPivotTable>;
  rows: SpreadsheetAxis;
  showGridLines: boolean;
  tables: ReadonlyArray<SpreadsheetTable>;
  usedRange: SpreadsheetRange | null;
}>;

export type SpreadsheetFeatureId =
  | "charts"
  | "comments"
  | "conditional-formatting"
  | "data-validation"
  | "defined-names"
  | "drawings"
  | "external-links"
  | "hyperlinks"
  | "images"
  | "macros"
  | "pivot-tables"
  | "tables";

export type SpreadsheetFeature = Readonly<{
  count: number;
  editableCount: number;
  id: SpreadsheetFeatureId;
  renderableCount: number;
  roundTripPreserved: boolean;
}>;

export type SpreadsheetDiagnostic = Readonly<{
  address?: string;
  code: string;
  message: string;
  part?: string;
  severity: "error" | "warning";
  sheetId?: string;
}>;

export type SpreadsheetWorkbookModel = Readonly<{
  dateSystem: SpreadsheetDateSystem;
  diagnostics: ReadonlyArray<SpreadsheetDiagnostic>;
  features: ReadonlyArray<SpreadsheetFeature>;
  objects: ReadonlyArray<SpreadsheetObject>;
  sheets: ReadonlyArray<SpreadsheetSheet>;
}>;

export type SpreadsheetDateSystem = "1900" | "1904";

export type SpreadsheetCellInput = Readonly<{
  formula?: string;
  formulaResult?: SpreadsheetScalar;
  value?: SpreadsheetScalar;
}>;

export type SpreadsheetOperation =
  | Readonly<{
      kind: "create-sheet";
      name: string;
      position?: number;
    }>
  | Readonly<{
      kind: "rename-sheet";
      name: string;
      sheetId: string;
    }>
  | Readonly<{
      kind: "delete-sheet";
      sheetId: string;
    }>
  | Readonly<{
      hidden: boolean;
      kind: "set-sheet-visibility";
      sheetId: string;
    }>
  | Readonly<{
      kind: "move-sheet";
      position: number;
      sheetId: string;
    }>
  | Readonly<{
      cells: ReadonlyArray<ReadonlyArray<SpreadsheetCellInput | SpreadsheetScalar>>;
      column: number;
      kind: "write-range";
      row: number;
      sheetId: string;
    }>
  | Readonly<{
      kind: "format-range";
      range: SpreadsheetRange;
      sheetId: string;
      style: SpreadsheetCellStyle;
    }>
  | Readonly<{
      axis: "columns" | "rows";
      end: number;
      hidden?: boolean;
      kind: "resize";
      sheetId: string;
      size?: number;
      start: number;
    }>
  | Readonly<{
      kind: "merge";
      range: SpreadsheetRange;
      sheetId: string;
    }>
  | Readonly<{
      kind: "unmerge";
      range: SpreadsheetRange;
      sheetId: string;
    }>
  | Readonly<{
      input: SpreadsheetCellInput | SpreadsheetScalar;
      kind: "fill-range";
      range: SpreadsheetRange;
      sheetId: string;
      translateFormula: boolean;
    }>
  | Readonly<{
      anchor: SpreadsheetObjectAnchor;
      chart: Omit<SpreadsheetChart, "id"> & { id?: string };
      kind: "create-chart";
      sheetId: string;
    }>
  | Readonly<{
      rule: SpreadsheetConditionalFormatInput;
      kind: "add-conditional-format";
      sheetId: string;
    }>
  | Readonly<{
      rule: Omit<SpreadsheetDataValidation, "id"> & { id?: string };
      kind: "add-data-validation";
      sheetId: string;
    }>
  | Readonly<{
      kind: "create-table";
      name: string;
      range: SpreadsheetRange;
      sheetId: string;
      showFilterButtons?: boolean;
      style?: string;
    }>
  | Readonly<{
      columnField?: string;
      kind: "create-pivot-table";
      name: string;
      rowFields: ReadonlyArray<string>;
      sourceRange: SpreadsheetRange;
      sourceSheetId: string;
      targetRange: SpreadsheetRange;
      targetSheetId: string;
      values: ReadonlyArray<SpreadsheetPivotValue>;
    }>;

export type SpreadsheetInspection = Readonly<{
  cells: ReadonlyArray<SpreadsheetCell>;
  range: SpreadsheetRange;
  sheet: Pick<SpreadsheetSheet, "frozenColumns" | "frozenRows" | "hidden" | "id" | "name">;
}>;

export type SpreadsheetVerification = Readonly<{
  byteSize: number;
  diagnostics: ReadonlyArray<SpreadsheetDiagnostic>;
  sha256: string;
  sheetCount: number;
  valid: boolean;
}>;

export type SpreadsheetTableColumnProfile = Readonly<{
  blankCount: number;
  column: number;
  distinctCount: number;
  distinctCountTruncated: boolean;
  maximum: number | null;
  minimum: number | null;
  name: string;
  nonBlankCount: number;
  sampleValues: ReadonlyArray<SpreadsheetProjectedValue>;
  types: Readonly<{
    boolean: number;
    number: number;
    string: number;
  }>;
}>;

export type SpreadsheetTableProfile = Readonly<{
  columns: ReadonlyArray<SpreadsheetTableColumnProfile>;
  dataRange: SpreadsheetRange | null;
  rowCount: number;
  sheetId: string;
  sheetName: string;
}>;

export type SpreadsheetTablePredicate = Readonly<{
  column: string;
  operator:
    | "contains"
    | "ends-with"
    | "equals"
    | "greater-than"
    | "greater-than-or-equal"
    | "is-blank"
    | "is-not-blank"
    | "less-than"
    | "less-than-or-equal"
    | "not-equals"
    | "starts-with";
  value?: SpreadsheetScalar;
}>;

export type SpreadsheetTableQuery = Readonly<{
  columns?: ReadonlyArray<string>;
  limit?: number;
  offset?: number;
  partitionBy?: string;
  partitionFilters?: ReadonlyArray<SpreadsheetTablePartitionFilter>;
  predicates?: ReadonlyArray<SpreadsheetTablePredicate>;
  range: SpreadsheetRange;
  sheetId: string;
}>;

export type SpreadsheetTableQueryResult = Readonly<{
  columns: ReadonlyArray<string>;
  matchedRowCount: number;
  rows: ReadonlyArray<ReadonlyArray<SpreadsheetProjectedValue>>;
  sheetId: string;
  truncated: boolean;
}>;

export type SpreadsheetTableAggregateMetric = Readonly<{
  column?: string;
  name?: string;
  operation: "average" | "count" | "count-distinct" | "maximum" | "minimum" | "sum";
}>;

export type SpreadsheetTableAggregateQuery = Readonly<{
  groupBy?: ReadonlyArray<string>;
  metrics: ReadonlyArray<SpreadsheetTableAggregateMetric>;
  partitionBy?: string;
  partitionFilters?: ReadonlyArray<SpreadsheetTablePartitionFilter>;
  predicates?: ReadonlyArray<SpreadsheetTablePredicate>;
  range: SpreadsheetRange;
  sheetId: string;
}>;

export type SpreadsheetTableAggregateResult = Readonly<{
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<SpreadsheetProjectedValue>>;
  sheetId: string;
  truncated: boolean;
}>;

export type SpreadsheetTablePartitionFilter = Readonly<{
  predicates: ReadonlyArray<SpreadsheetTablePredicate>;
  quantifier: "exists" | "not-exists";
}>;
