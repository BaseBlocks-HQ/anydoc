export type SpreadsheetScalar = string | number | boolean | null;

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
  chart?: SpreadsheetChartModel;
  id: string;
  kind: "chart" | "drawing" | "image";
  name?: string;
  relationshipTarget: string;
  sheetId: string;
}>;

export type SpreadsheetChartType = "bar" | "column" | "line" | "pie";

export type SpreadsheetRange = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}>;

export type SpreadsheetMerge = SpreadsheetRange;

export type SpreadsheetAxis = Readonly<{
  defaultSize: number;
  hidden: ReadonlySet<number>;
  sizes: ReadonlyMap<number, number>;
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
  columns: readonly string[];
  id: string;
  name: string;
  range: SpreadsheetRange;
  showFilterButtons: boolean;
  style: string;
}>;

export type SpreadsheetPivotTable = Readonly<{
  id: string;
  name: string;
  rowFields: readonly string[];
  sourceRange: SpreadsheetRange;
  sourceSheetId: string;
  targetRange: SpreadsheetRange;
  values: readonly {
    field: string;
    name?: string;
    summarizeBy: "average" | "count" | "maximum" | "minimum" | "sum";
  }[];
}>;

/** Chart model projected verbatim from the workbook's chart parts. */
export type SpreadsheetChartModel = Readonly<{
  groups: readonly {
    series: readonly {
      categories?: { cache: readonly SpreadsheetScalar[]; valueType: "number" | "string" };
      name?: string;
      values: { cache: readonly SpreadsheetScalar[]; valueType: "number" | "string" };
    }[];
    type: SpreadsheetChartType;
  }[];
  id: string;
  legend: "bottom" | "left" | "none" | "right" | "top";
  title?: string;
}>;

/** A chart resolved against the parsed workbook and ready to render. */
export type SpreadsheetRenderedChart = Readonly<{
  chartId: string;
  categories: readonly string[];
  legend: SpreadsheetChartModel["legend"];
  series: ReadonlyArray<
    Readonly<{
      name: string;
      type: SpreadsheetChartType;
      values: readonly number[];
    }>
  >;
  title?: string;
  type: SpreadsheetChartType;
}>;

export type SpreadsheetDiagnostic = Readonly<{
  address?: string;
  code: string;
  message: string;
  part?: string;
  severity: "error" | "warning";
  sheetId?: string;
}>;

export type SpreadsheetFeature = Readonly<{
  count: number;
  editableCount: number;
  id: string;
  renderableCount: number;
  roundTripPreserved: boolean;
}>;

export type SpreadsheetDateSystem = "1900" | "1904";

/**
 * A fully parsed worksheet as delivered by the Rust parser. Cells arrive as
 * an array and the axes' `Set`/`Map` fields arrive as arrays; the worker
 * adapter reconstructs the collection shapes before use.
 */
export type SpreadsheetSheetModel = Omit<
  SpreadsheetSheet,
  "cells" | "columns" | "rows"
> & {
  cells: readonly SpreadsheetCell[];
  columns: {
    defaultSize: number;
    hidden: readonly number[];
    sizes: readonly (readonly [number, number])[];
  };
  rows: {
    defaultSize: number;
    hidden: readonly number[];
    sizes: readonly (readonly [number, number])[];
  };
};

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

export type SpreadsheetWorkbookModel = Readonly<{
  dateSystem: SpreadsheetDateSystem;
  diagnostics: ReadonlyArray<SpreadsheetDiagnostic>;
  features: ReadonlyArray<SpreadsheetFeature>;
  sheets: ReadonlyArray<Readonly<SpreadsheetSheetModel & { renderedCharts: readonly SpreadsheetRenderedChart[] }>>;
}>;

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
