import { describe, expect, it } from "vitest";

import {
  aggregateSpreadsheetTable,
  cellAddress,
  cellKey,
  profileSpreadsheetTable,
  querySpreadsheetTable,
  type SpreadsheetCell,
  type SpreadsheetSheet,
} from "../src/index.js";

function largeSheet(rowCount: number): SpreadsheetSheet {
  const headers = ["Id", "First Name", "Last Name", "Country", "Age", "Revenue", "Active", "Note"];
  const cells = new Map<string, SpreadsheetCell>();
  const set = (row: number, column: number, value: string | number | boolean) => {
    cells.set(cellKey(row, column), {
      address: cellAddress(row, column),
      column,
      displayValue: String(value),
      row,
      style: {},
      value,
    });
  };
  headers.forEach((header, index) => set(1, index + 1, header));
  for (let index = 0; index < rowCount; index += 1) {
    const row = index + 2;
    set(row, 1, index + 1);
    set(row, 2, `First ${index}`);
    set(row, 3, `Last ${index}`);
    set(row, 4, index % 3 === 0 ? "France" : index % 3 === 1 ? "Germany" : "Spain");
    set(row, 5, 20 + (index % 50));
    set(row, 6, index * 1.25);
    set(row, 7, index % 2 === 0);
    set(row, 8, `Row ${index}`);
  }
  return {
    cells,
    conditionalFormats: [],
    columns: { defaultSize: 8.43, hidden: new Set(), sizes: new Map() },
    dataValidations: [],
    frozenColumns: 0,
    frozenRows: 1,
    hidden: false,
    id: "large",
    merges: [],
    name: "Large",
    objects: [],
    pivotTables: [],
    rows: { defaultSize: 15, hidden: new Set(), sizes: new Map() },
    showGridLines: true,
    tables: [],
    usedRange: { bottom: rowCount + 1, left: 1, right: headers.length, top: 1 },
  };
}

describe("bounded spreadsheet capacity", () => {
  it("reduces a 5,000-row inspection by more than 99% at the agent boundary", () => {
    const sheet = largeSheet(5_000);
    const sourcePayloadBytes = Buffer.byteLength(JSON.stringify([...sheet.cells.values()]));
    const profile = profileSpreadsheetTable(sheet, sheet.usedRange!);
    const profilePayloadBytes = Buffer.byteLength(JSON.stringify(profile));
    const query = querySpreadsheetTable(sheet, {
      columns: ["Id", "Revenue"],
      limit: 25,
      predicates: [{ column: "Country", operator: "equals", value: "France" }],
      range: sheet.usedRange!,
      sheetId: sheet.id,
    });
    const queryPayloadBytes = Buffer.byteLength(JSON.stringify(query));

    expect(sourcePayloadBytes).toBeGreaterThan(3_000_000);
    expect(profilePayloadBytes).toBeLessThan(10_000);
    expect(queryPayloadBytes).toBeLessThan(5_000);
    expect((profilePayloadBytes + queryPayloadBytes) / sourcePayloadBytes).toBeLessThan(0.01);
    expect(query).toMatchObject({ matchedRowCount: 1_667, truncated: true });
  });

  it("keeps related-row cohort analysis inside the engine", () => {
    const sheet = largeSheet(10_000);
    const caseColumn = 1;
    const providerColumn = 4;
    const missionColumn = 8;
    const cells = sheet.cells as Map<string, SpreadsheetCell>;
    const overwrite = (row: number, column: number, value: string) => {
      const current = cells.get(cellKey(row, column));
      if (!current) throw new Error(`Missing fixture cell ${row}:${column}.`);
      cells.set(cellKey(row, column), { ...current, displayValue: value, value });
    };
    overwrite(1, caseColumn, "Case");
    overwrite(1, providerColumn, "Provider");
    overwrite(1, missionColumn, "Mission");
    for (let index = 0; index < 10_000; index += 1) {
      const row = index + 2;
      const caseId = `Case ${Math.floor(index / 2)}`;
      const enterprise = index % 2 === 0;
      overwrite(row, caseColumn, caseId);
      overwrite(
        row,
        providerColumn,
        enterprise ? "Enterprise" : index % 4 === 1 ? "Taxi Co" : "Enterprise",
      );
      overwrite(row, missionColumn, enterprise ? "Rental" : "Taxi");
    }
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
    const query = querySpreadsheetTable(sheet, {
      columns: ["Case", "Provider"],
      limit: 25,
      partitionBy: "Case",
      partitionFilters,
      predicates: [{ column: "Mission", operator: "equals", value: "Taxi" }],
      range: sheet.usedRange!,
      sheetId: sheet.id,
    });
    const aggregate = aggregateSpreadsheetTable(sheet, {
      groupBy: ["Provider"],
      metrics: [{ column: "Case", name: "Cases", operation: "count-distinct" }],
      partitionBy: "Case",
      partitionFilters,
      predicates: [{ column: "Mission", operator: "equals", value: "Taxi" }],
      range: sheet.usedRange!,
      sheetId: sheet.id,
    });

    expect(query).toMatchObject({ matchedRowCount: 2_500, truncated: true });
    expect(aggregate.rows).toEqual([["Taxi Co", 2_500]]);
    expect(
      Buffer.byteLength(JSON.stringify(query)) + Buffer.byteLength(JSON.stringify(aggregate)),
    ).toBeLessThan(5_000);
  });
});
