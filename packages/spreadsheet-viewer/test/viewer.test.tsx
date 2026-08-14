import { describe, expect, it } from "vitest";

import { SpreadsheetEngine } from "@baseblocks/anydoc-spreadsheet-engine";

import { createSpreadsheetViewerReadSession } from "../src/index.ts";
import { generatedWorkbookFixture } from "./fixture.ts";

describe("spreadsheet viewer read-session integration", () => {
  it("opens metadata and reads only a requested range", async () => {
    const session = await createSpreadsheetViewerReadSession(await generatedWorkbookFixture());
    expect(session.metadata.sheets[0]?.name).toBe("Summary");
    expect(session.metadata.sheets[0]).not.toHaveProperty("cells");
    await expect(
      session.readRange("1", { bottom: 3, left: 2, right: 2, top: 3 }),
    ).resolves.toMatchObject({
      cells: [{ formula: "B2*0.1", formulaResult: 120 }],
      sheetId: "1",
    });
    session.close();
  });

  it("searches, summarizes, copies, and auto-fits through the session", async () => {
    const session = await createSpreadsheetViewerReadSession(await generatedWorkbookFixture());
    await expect(session.search("fees")).resolves.toMatchObject({
      matches: [{ address: "A3", sheetName: "Summary" }],
      total: 1,
    });
    await expect(
      session.selectionStatistics("1", [{ bottom: 3, left: 2, right: 2, top: 2 }]),
    ).resolves.toMatchObject({
      average: 660,
      count: 2,
      numericCount: 2,
      sum: 1320,
    });
    await expect(
      session.copy("1", [{ bottom: 3, left: 1, right: 2, top: 1 }]),
    ).resolves.toMatchObject({
      cellCount: 6,
      text: "Revenue\tAmount\nTickets\t1200\nFees\t120",
      truncated: false,
    });
    await expect(
      session.copy("1", [{ bottom: 1_048_576, left: 1, right: 16_384, top: 1 }]),
    ).resolves.toMatchObject({
      cellCount: 6,
      text: "Revenue\tAmount\nTickets\t1200\nFees\t120",
      truncated: false,
    });
    await expect(session.suggestAxisSize("1", "column", 1)).resolves.toBeGreaterThan(40);
    session.close();
  });

  it("projects native chart data through the same worker-safe read session", async () => {
    const workbook = await SpreadsheetEngine.open(new Uint8Array(await generatedWorkbookFixture()));
    workbook.apply({
      anchor: {
        from: { column: 4, columnOffsetEmu: 0, row: 2, rowOffsetEmu: 0 },
        kind: "two-cell",
        to: { column: 10, columnOffsetEmu: 0, row: 18, rowOffsetEmu: 0 },
      },
      chart: {
        legend: "bottom",
        series: [
          {
            categories: { range: { bottom: 3, left: 1, right: 1, top: 2 } },
            values: { range: { bottom: 3, left: 2, right: 2, top: 2 } },
          },
        ],
        title: "Revenue summary",
        type: "column",
      },
      kind: "create-chart",
      sheetId: "1",
    });
    const bytes = await workbook.export();
    const source = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(source).set(bytes);
    const session = await createSpreadsheetViewerReadSession(source);
    await expect(session.readCharts("1")).resolves.toEqual([
      expect.objectContaining({
        categories: ["Tickets", "Fees"],
        series: [expect.objectContaining({ values: [1200, 120] })],
        title: "Revenue summary",
      }),
    ]);
    session.close();
  });
});
