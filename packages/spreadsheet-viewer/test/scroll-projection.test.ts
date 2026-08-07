import { describe, expect, it } from "vitest";

import {
  createSpreadsheetScrollProjection,
  MAX_BROWSER_SCROLL_SIZE,
  projectSpreadsheetItemStart,
} from "../src/index.ts";

describe("spreadsheet scroll projection", () => {
  it("keeps small sheets in browser coordinates", () => {
    const projection = createSpreadsheetScrollProjection({
      logicalSize: 10_000,
      physicalOffset: 250,
      viewportSize: 500,
    });
    expect(projection.logicalOffset).toBe(250);
    expect(projectSpreadsheetItemStart(projection, 300)).toBe(300);
  });

  it("maps the complete XLSX row extent into a safe browser scroll range", () => {
    const viewportSize = 800;
    const logicalSize = 1_048_576 * 40;
    const projection = createSpreadsheetScrollProjection({
      logicalSize,
      physicalOffset: MAX_BROWSER_SCROLL_SIZE - viewportSize,
      viewportSize,
    });
    expect(projection.physicalSize).toBe(MAX_BROWSER_SCROLL_SIZE);
    expect(projection.logicalOffset).toBe(logicalSize - viewportSize);
  });
});
