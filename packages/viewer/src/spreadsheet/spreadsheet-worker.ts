import type { SpreadsheetRange } from "./model.js";
import { SpreadsheetReadSession } from "./session.js";

import type { SpreadsheetWorkerRequest, SpreadsheetWorkerResponse } from "./read-session.ts";
import type { DocumentLimits } from "@baseblocks/anydoc-contracts";

type WorkerPort = Readonly<{
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<SpreadsheetWorkerRequest>) => void,
  ) => void;
  postMessage: (message: SpreadsheetWorkerResponse) => void;
}>;

const port = globalThis as unknown as WorkerPort;
let session: SpreadsheetReadSession | null = null;

port.addEventListener("message", (event) => {
  void handleRequest(event.data)
    .then((result) => port.postMessage({ id: event.data.id, result }))
    .catch((cause: unknown) =>
      port.postMessage({
        error: cause instanceof Error ? cause.message : "The spreadsheet request failed.",
        id: event.data.id,
      }),
    );
});

async function handleRequest(request: SpreadsheetWorkerRequest): Promise<unknown> {
  if (request.method === "open") {
    const source = request.args[0];
    const format = request.args[1] === "csv" ? "csv" : "xlsx";
    const limits = request.args[2] as Pick<DocumentLimits, "maxBytes" | "maxSpreadsheetCells">;
    if (!(source instanceof ArrayBuffer)) throw new Error("The workbook source is invalid.");
    session = await (
      format === "csv"
        ? SpreadsheetReadSession.openCsv(new Uint8Array(source), { maxCells: limits.maxSpreadsheetCells, maxInputBytes: limits.maxBytes })
        : SpreadsheetReadSession.open(new Uint8Array(source), { maxCells: limits.maxSpreadsheetCells, maxInputBytes: limits.maxBytes })
    );
    return session.metadata;
  }
  if (!session) throw new Error("No workbook is open.");
  if (request.method === "readCharts") return session.readCharts(request.args[0] as string);
  if (request.method === "readRange") {
    return session.readRange(request.args[0] as string, request.args[1] as SpreadsheetRange);
  }
  if (request.method === "search") return session.search(request.args[0] as string);
  if (request.method === "selectionStatistics") {
    return session.selectionStatistics(
      request.args[0] as string,
      request.args[1] as SpreadsheetRange[],
    );
  }
  if (request.method === "copy") {
    return session.copy(request.args[0] as string, request.args[1] as SpreadsheetRange[]);
  }
  if (request.method === "suggestAxisSize") {
    return session.suggestAxisSize(
      request.args[0] as string,
      request.args[1] as "column" | "row",
      request.args[2] as number,
    );
  }
  throw new Error("Unsupported spreadsheet worker request.");
}
