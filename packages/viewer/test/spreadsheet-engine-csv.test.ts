import { describe, expect, it } from "vitest";
import { SpreadsheetReadSession } from "../src/spreadsheet/engine/read-session.js";

describe("CSV read sessions", () => {
  it("parses quoted fields and keeps formula-like values inert", () => {
    const session = SpreadsheetReadSession.openCsv(
      new TextEncoder().encode('name,value\n"Ada, Lovelace",=2+2\n'),
    );
    const read = session.readRange("csv-sheet-1", {
      bottom: 2,
      left: 1,
      right: 2,
      top: 1,
    });
    expect(read.cells.map((cell) => cell.displayValue)).toEqual([
      "name",
      "value",
      "Ada, Lovelace",
      "=2+2",
    ]);
    expect(read.cells.at(-1)?.formula).toBeUndefined();
  });

  it("rejects malformed quoted fields", () => {
    expect(() =>
      SpreadsheetReadSession.openCsv(new TextEncoder().encode('"unterminated')),
    ).toThrow(/unterminated/u);
  });

  it("sniffs semicolon delimiters without splitting decimal commas", () => {
    const session = SpreadsheetReadSession.openCsv(
      new TextEncoder().encode('name;value\nNorth;"1,5"\nSouth;"2,5"\n'),
    );
    const read = session.readRange("csv-sheet-1", {
      bottom: 3,
      left: 1,
      right: 2,
      top: 1,
    });
    expect(read.cells.map((cell) => cell.displayValue)).toEqual([
      "name",
      "value",
      "North",
      "1,5",
      "South",
      "2,5",
    ]);
  });

  it("decodes UTF-16LE CSV input", () => {
    const text = "name,value\nAda,42\n";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      bytes[2 + index * 2] = code & 0xff;
      bytes[3 + index * 2] = code >> 8;
    }
    const session = SpreadsheetReadSession.openCsv(bytes);
    expect(
      session
        .readRange("csv-sheet-1", { bottom: 2, left: 1, right: 2, top: 1 })
        .cells.map((cell) => cell.displayValue),
    ).toEqual(["name", "value", "Ada", "42"]);
  });
});
