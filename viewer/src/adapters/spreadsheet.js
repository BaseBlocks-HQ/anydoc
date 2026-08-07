export const formats = ["xlsx", "csv"];
export const dependency = "AnyDoc spreadsheet engine adapter";
export function createSpreadsheetPolicy() { return { executeFormulas: false, allowExternalReferences: false, virtualize: true, maxCells: 100000, maxRows: 100000 }; }
