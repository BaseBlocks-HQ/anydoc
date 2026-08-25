import {
  SpreadsheetReadSession,
} from "./session.js";
import type {
  SpreadsheetCopyResult,
  SpreadsheetRange,
  SpreadsheetRangeRead,
  SpreadsheetRenderedChart,
  SpreadsheetSearchResult,
  SpreadsheetSelectionStatistics,
  SpreadsheetWorkbookMetadata,
} from "./model.js";
import { defaultDocumentLimits, type DocumentLimits } from "@baseblocks/anydoc-contracts";

export type SpreadsheetViewerReadSession = Readonly<{
  close: () => void;
  copy: (sheetId: string, ranges: readonly SpreadsheetRange[]) => Promise<SpreadsheetCopyResult>;
  metadata: SpreadsheetWorkbookMetadata;
  readCharts: (sheetId: string) => Promise<readonly SpreadsheetRenderedChart[]>;
  readRange: (sheetId: string, range: SpreadsheetRange) => Promise<SpreadsheetRangeRead>;
  search: (query: string) => Promise<SpreadsheetSearchResult>;
  selectionStatistics: (
    sheetId: string,
    ranges: readonly SpreadsheetRange[],
  ) => Promise<SpreadsheetSelectionStatistics>;
  suggestAxisSize: (sheetId: string, axis: "column" | "row", index: number) => Promise<number>;
}>;

export type SpreadsheetWorkerMethod =
  | "copy"
  | "open"
  | "readCharts"
  | "readRange"
  | "search"
  | "selectionStatistics"
  | "suggestAxisSize";

export type SpreadsheetWorkerRequest = Readonly<{
  args: readonly unknown[];
  id: number;
  method: SpreadsheetWorkerMethod;
}>;

export type SpreadsheetWorkerResponse = Readonly<{
  error?: string;
  id: number;
  result?: unknown;
}>;

class LocalSpreadsheetViewerReadSession implements SpreadsheetViewerReadSession {
  readonly #session: SpreadsheetReadSession;

  constructor(session: SpreadsheetReadSession) {
    this.#session = session;
  }

  get metadata(): SpreadsheetWorkbookMetadata {
    return this.#session.metadata;
  }

  close(): void {}

  async copy(sheetId: string, ranges: readonly SpreadsheetRange[]) {
    return this.#session.copy(sheetId, ranges);
  }

  async readRange(sheetId: string, range: SpreadsheetRange) {
    return this.#session.readRange(sheetId, range);
  }

  async readCharts(sheetId: string) {
    return this.#session.readCharts(sheetId);
  }

  async search(query: string) {
    return this.#session.search(query);
  }

  async selectionStatistics(sheetId: string, ranges: readonly SpreadsheetRange[]) {
    return this.#session.selectionStatistics(sheetId, ranges);
  }

  async suggestAxisSize(sheetId: string, axis: "column" | "row", index: number) {
    return this.#session.suggestAxisSize(sheetId, axis, index);
  }
}

class WorkerSpreadsheetViewerReadSession implements SpreadsheetViewerReadSession {
  readonly #pending = new Map<
    number,
    Readonly<{ reject: (reason: Error) => void; resolve: (value: unknown) => void }>
  >();
  readonly #worker: Worker;
  #nextId = 1;
  #metadata: SpreadsheetWorkbookMetadata | null = null;

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", this.#onMessage);
    worker.addEventListener("error", this.#onError);
  }

  get metadata(): SpreadsheetWorkbookMetadata {
    if (!this.#metadata) throw new Error("The spreadsheet worker has not opened a workbook.");
    return this.#metadata;
  }

  async open(source: ArrayBuffer, format: "csv" | "xlsx", limits: Pick<DocumentLimits, "maxBytes" | "maxSpreadsheetCells">): Promise<void> {
    const transferable = source.slice(0);
    this.#metadata = await this.#call<SpreadsheetWorkbookMetadata>(
      "open",
      [transferable, format, limits],
      [transferable],
    );
  }

  close(): void {
    this.#worker.removeEventListener("message", this.#onMessage);
    this.#worker.removeEventListener("error", this.#onError);
    this.#worker.terminate();
    const error = new Error("The spreadsheet read session was closed.");
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  copy(sheetId: string, ranges: readonly SpreadsheetRange[]) {
    return this.#call<SpreadsheetCopyResult>("copy", [sheetId, ranges]);
  }

  readRange(sheetId: string, range: SpreadsheetRange) {
    return this.#call<SpreadsheetRangeRead>("readRange", [sheetId, range]);
  }

  readCharts(sheetId: string) {
    return this.#call<readonly SpreadsheetRenderedChart[]>("readCharts", [sheetId]);
  }

  search(query: string) {
    return this.#call<SpreadsheetSearchResult>("search", [query]);
  }

  selectionStatistics(sheetId: string, ranges: readonly SpreadsheetRange[]) {
    return this.#call<SpreadsheetSelectionStatistics>("selectionStatistics", [sheetId, ranges]);
  }

  suggestAxisSize(sheetId: string, axis: "column" | "row", index: number) {
    return this.#call<number>("suggestAxisSize", [sheetId, axis, index]);
  }

  #call<Result>(
    method: SpreadsheetWorkerMethod,
    args: readonly unknown[],
    transfer: Transferable[] = [],
  ): Promise<Result> {
    const id = this.#nextId++;
    return new Promise<Result>((resolve, reject) => {
      this.#pending.set(id, {
        reject,
        resolve: (value) => resolve(value as Result),
      });
      this.#worker.postMessage({ args, id, method } satisfies SpreadsheetWorkerRequest, transfer);
    });
  }

  #onMessage = (event: MessageEvent<SpreadsheetWorkerResponse>) => {
    const pending = this.#pending.get(event.data.id);
    if (!pending) return;
    this.#pending.delete(event.data.id);
    if (event.data.error) pending.reject(new Error(event.data.error));
    else pending.resolve(event.data.result);
  };

  #onError = (event: ErrorEvent) => {
    const error = new Error(event.message || "The spreadsheet worker failed.");
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  };
}

export async function createSpreadsheetViewerReadSession(
  source: ArrayBuffer,
  format: "csv" | "xlsx" = "xlsx",
  limits: Pick<DocumentLimits, "maxBytes" | "maxSpreadsheetCells"> = defaultDocumentLimits,
): Promise<SpreadsheetViewerReadSession> {
  if (typeof Worker !== "undefined") {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./spreadsheet-worker.js", import.meta.url), {
        name: "anydoc-spreadsheet-reader",
        type: "module",
      });
    } catch {
      // Some embedded webviews expose Worker without supporting module workers. Keep parity there.
    }
    if (worker) {
      const session = new WorkerSpreadsheetViewerReadSession(worker);
      try {
        await session.open(source, format, limits);
        return session;
      } catch (cause) {
        session.close();
        throw cause;
      }
    }
  }
  const session =
    format === "csv"
      ? await SpreadsheetReadSession.openCsv(new Uint8Array(source), { maxCells: limits.maxSpreadsheetCells, maxInputBytes: limits.maxBytes })
      : await SpreadsheetReadSession.open(new Uint8Array(source), { maxCells: limits.maxSpreadsheetCells, maxInputBytes: limits.maxBytes });
  return new LocalSpreadsheetViewerReadSession(session);
}
