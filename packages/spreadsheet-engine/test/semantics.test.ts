import { describe, expect, it } from "vitest";

import {
  aggregateSpreadsheetTable,
  cellAddress,
  cellKey,
  formatSpreadsheetValue,
  profileSpreadsheetTable,
  querySpreadsheetTable,
  translateSpreadsheetFormula,
  type SpreadsheetCell,
  type SpreadsheetScalar,
  type SpreadsheetSheet,
} from "../src/index.ts";

function tableSheet(rows: readonly (readonly SpreadsheetScalar[])[]): SpreadsheetSheet {
  const cells = new Map<string, SpreadsheetCell>();
  rows.forEach((values, rowIndex) =>
    values.forEach((value, columnIndex) => {
      const row = rowIndex + 1;
      const column = columnIndex + 1;
      cells.set(cellKey(row, column), {
        address: cellAddress(row, column),
        column,
        displayValue: value === null ? "" : String(value),
        row,
        style: {},
        value,
      });
    }),
  );
  return {
    cells,
    conditionalFormats: [],
    columns: { defaultSize: 8.43, hidden: new Set(), sizes: new Map() },
    dataValidations: [],
    frozenColumns: 0,
    frozenRows: 1,
    hidden: false,
    id: "sales",
    merges: [],
    name: "Sales",
    objects: [],
    pivotTables: [],
    rows: { defaultSize: 15, hidden: new Set(), sizes: new Map() },
    showGridLines: true,
    tables: [],
    usedRange: {
      bottom: rows.length,
      left: 1,
      right: Math.max(...rows.map((row) => row.length)),
      top: 1,
    },
  };
}

describe("spreadsheet semantic engine", () => {
  it("formats displayed values once for every consumer", () => {
    expect(formatSpreadsheetValue(0.125, { numberFormat: "0.0%" }, "1900")).toBe("12.5%");
    expect(formatSpreadsheetValue(1234.5, { numberFormat: "$#,##0.00" }, "1900")).toMatch(
      /^\$1[,.]234[,.]50$/u,
    );
    expect(formatSpreadsheetValue(-50, { numberFormat: "#,##0.00;(#,##0.00)" }, "1900")).toBe(
      "(50.00)",
    );
    const date = formatSpreadsheetValue(43_152, { numberFormat: "m/d/yy" }, "1900");
    expect(date).not.toBe("43152");
    expect(date).toMatch(/18|2018/u);
  });

  it("profiles, filters, and aggregates tables without returning source cells", () => {
    const sheet = tableSheet([
      ["Country", "Revenue", "Customer"],
      ["France", 100, "A"],
      ["France", 150, "B"],
      ["Germany", 80, "C"],
      ["France", 25, "A"],
    ]);
    const range = { bottom: 5, left: 1, right: 3, top: 1 };
    const profile = profileSpreadsheetTable(sheet, range);
    expect(profile).toMatchObject({
      rowCount: 4,
      sheetId: "sales",
    });
    expect(profile.columns.find(({ name }) => name === "Revenue")).toMatchObject({
      maximum: 150,
      minimum: 25,
      nonBlankCount: 4,
      types: { boolean: 0, number: 4, string: 0 },
    });

    expect(
      querySpreadsheetTable(sheet, {
        columns: ["Customer", "Revenue"],
        predicates: [{ column: "Country", operator: "equals", value: "France" }],
        range,
        sheetId: "sales",
      }),
    ).toEqual({
      columns: ["Customer", "Revenue"],
      matchedRowCount: 3,
      rows: [
        ["A", 100],
        ["B", 150],
        ["A", 25],
      ],
      sheetId: "sales",
      truncated: false,
    });

    expect(
      aggregateSpreadsheetTable(sheet, {
        groupBy: ["Country"],
        metrics: [
          { column: "Revenue", name: "Revenue", operation: "sum" },
          { column: "Customer", name: "Customers", operation: "count-distinct" },
        ],
        range,
        sheetId: "sales",
      }),
    ).toEqual({
      columns: ["Country", "Revenue", "Customers"],
      rows: [
        ["France", 275, 2],
        ["Germany", 80, 1],
      ],
      sheetId: "sales",
      truncated: false,
    });
  });

  it("filters entity cohorts across related rows before querying and aggregating", () => {
    const sheet = tableSheet([
      ["Case", "Provider", "Mission", "Amount"],
      ["A", "Enterprise", "Rental", 100],
      ["A", "Taxi Co", "Taxi", 25],
      ["B", "Enterprise", "Rental", 120],
      ["B", "Enterprise", "Pickup", 10],
      ["C", "Taxi Co", "Taxi", 30],
      ["D", "Enterprise", "Rental", 90],
      ["D", "Other Taxi", "Taxi", 20],
    ]);
    const range = { bottom: 8, left: 1, right: 4, top: 1 };
    const partitionFilters = [
      {
        predicates: [{ column: "Provider", operator: "equals" as const, value: "Enterprise" }],
        quantifier: "exists" as const,
      },
      {
        predicates: [
          { column: "Mission", operator: "equals" as const, value: "Taxi" },
          { column: "Provider", operator: "not-equals" as const, value: "Enterprise" },
        ],
        quantifier: "exists" as const,
      },
    ];

    expect(
      querySpreadsheetTable(sheet, {
        columns: ["Case", "Provider", "Amount"],
        partitionBy: "Case",
        partitionFilters,
        predicates: [{ column: "Mission", operator: "equals", value: "Taxi" }],
        range,
        sheetId: "sales",
      }),
    ).toMatchObject({
      matchedRowCount: 2,
      rows: [
        ["A", "Taxi Co", 25],
        ["D", "Other Taxi", 20],
      ],
      truncated: false,
    });

    expect(
      aggregateSpreadsheetTable(sheet, {
        groupBy: ["Provider"],
        metrics: [
          { column: "Case", name: "Cases", operation: "count-distinct" },
          { column: "Amount", name: "Amount", operation: "sum" },
        ],
        partitionBy: "Case",
        partitionFilters,
        predicates: [{ column: "Mission", operator: "equals", value: "Taxi" }],
        range,
        sheetId: "sales",
      }),
    ).toEqual({
      columns: ["Provider", "Cases", "Amount"],
      rows: [
        ["Taxi Co", 1, 25],
        ["Other Taxi", 1, 20],
      ],
      sheetId: "sales",
      truncated: false,
    });

    expect(
      querySpreadsheetTable(sheet, {
        columns: ["Case", "Provider"],
        partitionBy: "Case",
        partitionFilters: [
          partitionFilters[0]!,
          {
            predicates: [{ column: "Mission", operator: "equals", value: "Taxi" }],
            quantifier: "not-exists",
          },
        ],
        range,
        sheetId: "sales",
      }),
    ).toMatchObject({
      matchedRowCount: 2,
      rows: [
        ["B", "Enterprise"],
        ["B", "Enterprise"],
      ],
    });
  });

  it("translates relative formula references for compact fills", () => {
    expect(translateSpreadsheetFormula("A1+$B1+C$2+$D$4", 2, 3)).toBe("D3+$B3+F$2+$D$4");
    expect(translateSpreadsheetFormula("'Input Data'!A1*2", 4, 1)).toBe("'Input Data'!B5*2");
    expect(translateSpreadsheetFormula('IF(A1="B2",C1,D1)', 1, 1)).toBe('IF(B2="B2",D2,E2)');
  });
});
