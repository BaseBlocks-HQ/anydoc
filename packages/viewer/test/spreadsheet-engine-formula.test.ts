import { describe, expect, it } from "vitest";

import {
  BuiltInFormulaEngine,
  type FormulaEngineCell,
  type FormulaEngineSheet,
  cellKey,
} from "../src/index.js";

function sheet(
  id: string,
  name: string,
  cells: ReadonlyArray<FormulaEngineCell>,
): FormulaEngineSheet {
  return {
    cells: new Map(cells.map((cell) => [cellKey(cell.row, cell.column), cell])),
    id,
    name,
  };
}

describe("BuiltInFormulaEngine", () => {
  it("evaluates dependencies, ranges, common functions, IF, and cross-sheet references", () => {
    const engine = new BuiltInFormulaEngine();
    const result = engine.recalculate({
      sheets: [
        sheet("inputs", "Inputs", [
          { column: 1, row: 1, value: 10 },
          { column: 1, row: 2, value: 20 },
          { column: 2, formula: "SUM(A1:A2)", row: 1, value: null },
          { column: 2, formula: "AVERAGE(A1:A2)", row: 2, value: null },
          { column: 2, formula: "IF(B1>25,MAX(A1:A2),MIN(A1:A2))", row: 3, value: null },
          { column: 2, formula: "COUNT(A1:B2)", row: 4, value: null },
        ]),
        sheet("summary", "Executive Summary", [
          {
            column: 1,
            formula: "Inputs!B3+MIN(Inputs!A1:A2)",
            row: 1,
            value: null,
          },
          {
            column: 1,
            formula: "'Executive Summary'!A1^2",
            row: 2,
            value: null,
          },
        ]),
      ],
    });
    const updates = new Map(
      result.updates.map((update) => [
        `${update.sheetId}:${update.row}:${update.column}`,
        update.value,
      ]),
    );
    expect(result.diagnostics).toEqual([]);
    expect(updates.get("inputs:1:2")).toBe(30);
    expect(updates.get("inputs:2:2")).toBe(15);
    expect(updates.get("inputs:3:2")).toBe(20);
    expect(updates.get("inputs:4:2")).toBe(4);
    expect(updates.get("summary:1:1")).toBe(30);
    expect(updates.get("summary:2:1")).toBe(900);
  });

  it("detects cycles and unsupported functions without claiming Excel parity", () => {
    const result = new BuiltInFormulaEngine().recalculate({
      sheets: [
        sheet("one", "One", [
          { column: 1, formula: "B1", row: 1, value: null },
          { column: 2, formula: "A1", row: 1, value: null },
          { column: 3, formula: "XLOOKUP(1,A1:A2,B1:B2)", row: 1, value: null },
        ]),
      ],
    });
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "formula.cycle")).toBe(true);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === "formula.unsupported-function"),
    ).toBe(true);
    expect(result.updates.find((update) => update.column === 3)?.value).toBe("#NAME?");
  });
});
