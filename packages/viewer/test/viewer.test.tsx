import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSpreadsheetViewerReadSession } from "../src/spreadsheet/read-session.js";
import { generatedCheckboxWorkbookFixture, generatedWorkbookFixture } from "./fixture.ts";

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
    const session = await createSpreadsheetViewerReadSession(await generatedWorkbookFixture());
    const charts = await session.readCharts("1");
    expect(charts).toHaveLength(1);
    expect(charts[0]).toMatchObject({
      categories: ["Tickets", "Fees"],
      series: [expect.objectContaining({ values: [1200, 120] })],
      title: "Revenue summary",
      type: "column",
      legend: "bottom",
    });
    session.close();
  });

  it("keeps chart anchors so the native grid can place the rendered charts", async () => {
    const source = new Uint8Array(
      await readFile(path.resolve(import.meta.dirname, "../../../apps/playground/src/assets/samples/workbook.xlsx")),
    );
    const sourceBuffer = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ) as ArrayBuffer;
    const session = await createSpreadsheetViewerReadSession(sourceBuffer);
    const objects = session.metadata.sheets[0]?.objects ?? [];
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({
      anchor: {
        from: { column: 9, row: 5 },
        kind: "two-cell",
        to: { column: 18, row: 29 },
      },
      kind: "chart",
    });
    expect(objects[1]).toMatchObject({
      anchor: {
        from: { column: 2, row: 14 },
        kind: "two-cell",
        to: { column: 7, row: 28 },
      },
      kind: "chart",
    });
    session.close();
  });

  it("projects legacy Excel checkboxes into anchored viewer metadata and copy output", async () => {
    const session = await createSpreadsheetViewerReadSession(
      await generatedCheckboxWorkbookFixture(),
    );
    expect(session.metadata.sheets[0]).toMatchObject({
      checkboxes: [
        { caption: "Done", checked: true, column: 2, row: 1 },
        { caption: "", checked: false, column: 3, row: 2 },
      ],
      usedRange: { bottom: 2, left: 1, right: 3, top: 1 },
    });
    await expect(session.search("done")).resolves.toMatchObject({
      matches: [{ address: "B1", column: 2, row: 1, preview: "[x] Done" }],
      total: 1,
    });
    await expect(session.copy("1", [{ bottom: 2, left: 1, right: 3, top: 1 }])).resolves.toMatchObject({
      text: "Tasks\t[x] Done\t\nReview\t\t[ ]",
    });
    session.close();
  });
});
