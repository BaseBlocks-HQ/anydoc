import type {
  SpreadsheetDateSystem,
  SpreadsheetDiagnostic,
  SpreadsheetFeature,
  SpreadsheetSheetModel,
  SpreadsheetWorkbookModel,
} from "./model.js";

/**
 * Raw workbook model shapes crossing the Wasm boundary before the session
 * adapter reconstructs `Set`/`Map` fields.
 */
export type WasmWorkbookModel = Readonly<{
  dateSystem: SpreadsheetDateSystem;
  diagnostics: SpreadsheetDiagnostic[];
  features: SpreadsheetFeature[];
  objects: unknown[];
  sheets: ReadonlyArray<SpreadsheetSheetModel & { renderedCharts: unknown[] }>;
}>;

type WasmExports = {
  openWorkbook: (bytes: Uint8Array, limits: Record<string, number>) => WasmWorkbookModel;
  parseCsvBytes: (bytes: Uint8Array, limits: Record<string, number>) => WasmWorkbookModel;
};

type WasmGlue = {
  default?: () => Promise<void>;
  initSync?: (input: { module: BufferSource | WebAssembly.Module }) => void;
  openWorkbook: WasmExports["openWorkbook"];
  parseCsvBytes: WasmExports["parseCsvBytes"];
};

let exportsPromise: Promise<WasmExports> | null = null;

function isNode(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    process.versions.node !== undefined
  );
}

// Specifier fragments are assembled at runtime so bundlers never try to
// resolve the engine asset statically: the browser fetches it lazily next to
// this module, and tests resolve it against the crate's pkg/ output.
const glueFile = ["spreadsheet", "view.js"].join("_");
const wasmFile = ["spreadsheet", "view_bg.wasm"].join("_");
const devGluePath = ["../../../../spreadsheet-", `view/pkg/${glueFile}`].join("");

async function loadFrom(glueUrl: URL): Promise<WasmExports | undefined> {
  if (isNode()) {
    const fsPromises = "node:" + "fs/promises";
    const { readFile } = await import(fsPromises);
    const bytes = await readFile(new URL(wasmFile, glueUrl));
    const glue = (await import(glueUrl.href)) as WasmGlue;
    if (typeof glue.initSync !== "function" || typeof glue.openWorkbook !== "function") {
      return undefined;
    }
    glue.initSync({ module: await WebAssembly.compile(bytes) });
    return glue as WasmExports;
  }
  const glue = (await import(glueUrl.href)) as WasmGlue;
  if (typeof glue.default !== "function" || typeof glue.openWorkbook !== "function") {
    return undefined;
  }
  await glue.default();
  return glue as WasmExports;
}

async function loadExports(): Promise<WasmExports> {
  for (const relative of [glueFile, devGluePath]) {
    try {
      const exports = await loadFrom(new URL(relative, import.meta.url));
      if (exports) return exports;
    } catch {
      continue;
    }
  }
  throw new Error("The spreadsheet engine could not be loaded.");
}

/** The lazily-initialized spreadsheet parser exports. */
export function spreadsheetWasm(): Promise<WasmExports> {
  exportsPromise ??= loadExports();
  return exportsPromise;
}

export async function openWorkbookModel(
  bytes: Uint8Array,
  limits: { maxCells?: number; maxInputBytes?: number },
): Promise<SpreadsheetWorkbookModel> {
  const exports = await spreadsheetWasm();
  const model = exports.openWorkbook(bytes, {
    ...(limits.maxCells !== undefined ? { maxCells: limits.maxCells } : {}),
    ...(limits.maxInputBytes !== undefined ? { maxInputBytes: limits.maxInputBytes } : {}),
  });
  return model as unknown as SpreadsheetWorkbookModel;
}

export async function parseCsvModel(
  bytes: Uint8Array,
  limits: { maxCells?: number; maxInputBytes?: number },
): Promise<SpreadsheetWorkbookModel> {
  const exports = await spreadsheetWasm();
  const model = exports.parseCsvBytes(bytes, {
    ...(limits.maxCells !== undefined ? { maxCells: limits.maxCells } : {}),
    ...(limits.maxInputBytes !== undefined ? { maxInputBytes: limits.maxInputBytes } : {}),
  });
  return model as unknown as SpreadsheetWorkbookModel;
}
