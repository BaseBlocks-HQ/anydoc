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
  default?: (input?: BufferSource) => Promise<unknown>;
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

const packagedWasmUrl = new URL("./spreadsheet_view_bg.wasm", import.meta.url);
function developmentWasmUrl(): URL {
  // Keep the source-tree fallback opaque to consumer bundlers. The published
  // package always uses `packagedWasmUrl`; this path is for local Node tests.
  const relativePath = ["../../../../spreadsheet-", "view/pkg/spreadsheet_view_bg.wasm"].join("");
  return new URL(relativePath, import.meta.url);
}

type NodeFsPromises = {
  readFile: (path: URL) => Promise<Uint8Array>;
};

function nodeReadFile(): NodeFsPromises["readFile"] | undefined {
  const getBuiltinModule = (
    process as typeof process & { getBuiltinModule?: (id: string) => unknown }
  ).getBuiltinModule;
  return (getBuiltinModule?.("node:fs/promises") as NodeFsPromises | undefined)?.readFile;
}

async function loadInNode(glue: WasmGlue): Promise<WasmExports | undefined> {
  if (typeof glue.initSync !== "function" || typeof glue.openWorkbook !== "function") {
    return undefined;
  }
  const readFile = nodeReadFile();
  if (!readFile) return undefined;

  for (const wasmUrl of [packagedWasmUrl, developmentWasmUrl()]) {
    try {
      const bytes = await readFile(wasmUrl);
      glue.initSync({ module: await WebAssembly.compile(bytes as unknown as BufferSource) });
      return glue as WasmExports;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function loadInBrowser(glue: WasmGlue): Promise<WasmExports | undefined> {
  if (typeof glue.default !== "function" || typeof glue.openWorkbook !== "function") {
    return undefined;
  }

  for (const wasmUrl of [packagedWasmUrl, developmentWasmUrl()]) {
    try {
      const response = await fetch(wasmUrl);
      if (!response.ok) continue;
      await glue.default(await response.arrayBuffer());
      return glue as WasmExports;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function loadExports(): Promise<WasmExports> {
  // Keep this specifier literal. Next/Turbopack and Vite can then include the
  // lazy engine module in their browser graphs without replacing the import
  // with an "unknown module" stub.
  const glue = (await import("./spreadsheet-engine.js")) as unknown as WasmGlue;
  const exports = isNode() ? await loadInNode(glue) : await loadInBrowser(glue);
  if (exports) return exports;
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
