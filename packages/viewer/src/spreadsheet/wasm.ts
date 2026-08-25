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

/** Repository-layout fallback so tests can run the artifact before packaging. */
function developmentGlueUrl(): URL {
  return new URL("../../../../spreadsheet-view/pkg/spreadsheet_view.js", import.meta.url);
}

async function loadInNode(): Promise<WasmExports> {
  // Computed specifiers keep bundlers from resolving Node builtins into
  // browser graphs; this branch only runs outside the browser.
  const fsPromises = "node:fs" + "/promises";
  const { readFile } = await import(/* @vite-ignore */ fsPromises);
  for (const glueUrl of [new URL("./spreadsheet-view.js", import.meta.url), developmentGlueUrl()]) {
    try {
      const [wasmBytes] = await Promise.all([
        readFile(new URL("./spreadsheet_view_bg.wasm", glueUrl)),
      ]);
      const glue = (await import(glueUrl.href)) as WasmGlue;
      if (typeof glue.initSync !== "function" || typeof glue.openWorkbook !== "function") {
        continue;
      }
      glue.initSync({ module: await WebAssembly.compile(wasmBytes) });
      return glue as WasmExports;
    } catch {
      continue;
    }
  }
  throw new Error("The spreadsheet engine could not be loaded.");
}

async function loadExports(): Promise<WasmExports> {
  if (isNode()) return loadInNode();
  const glue = (await import(
    /* @vite-ignore */ new URL("./spreadsheet-view.js", import.meta.url).href
  )) as WasmGlue;
  if (typeof glue.default !== "function") {
    throw new Error("The spreadsheet engine is missing its Wasm initializer.");
  }
  await glue.default();
  return glue as WasmExports;
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
