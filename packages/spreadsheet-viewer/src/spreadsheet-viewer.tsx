import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DocumentPlatformError, defaultDocumentLimits } from "@baseblocks/anydoc-contracts";
import {
  ViewerControlRegion,
  type ViewerControls,
  type ViewerControlSetting,
} from "@baseblocks/anydoc-viewer-ui";

import type {
  SpreadsheetCell,
  SpreadsheetSearchMatch,
  SpreadsheetSelectionStatistics,
  SpreadsheetSheetMetadata,
  SpreadsheetWorkbookMetadata,
} from "@baseblocks/anydoc-spreadsheet-engine";

import { SpreadsheetErrorBoundary } from "./error-boundary.tsx";
import {
  createSpreadsheetViewerReadSession,
  type SpreadsheetViewerReadSession,
} from "./read-session.ts";
import { SheetGrid } from "./sheet-grid.tsx";
import {
  INITIAL_SPREADSHEET_SELECTION,
  activeSelectionRange,
  cellHyperlink,
  createSpreadsheetSelectionRange,
  formulaBarValue,
  normalizedSelectionRanges,
  selectionAddress,
  type SpreadsheetSelection,
} from "./viewer-model.ts";

type LocalSheetSizes = Readonly<{
  columns: ReadonlyMap<number, number>;
  rows: ReadonlyMap<number, number>;
}>;

const EMPTY_STATISTICS: SpreadsheetSelectionStatistics = {
  average: null,
  count: 0,
  maximum: null,
  minimum: null,
  numericCount: 0,
  sum: null,
};

const STATISTIC_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export type SpreadsheetAppearance = "dark" | "light";

export type SpreadsheetViewerControls = ViewerControls;

export type SpreadsheetViewerProps = Readonly<{
  appearance?: SpreadsheetAppearance;
  controls?: ViewerControlSetting;
  defaultAppearance?: SpreadsheetAppearance;
  onAppearanceChange?: (appearance: SpreadsheetAppearance) => void;
  onControls?: ((controls: ViewerControls | null) => void) | undefined;
  format?: "csv" | "xlsx";
  maxBytes?: number;
  maxCells?: number;
  onError?: (error: DocumentPlatformError) => void;
  signal?: AbortSignal;
  source: ArrayBuffer;
  title?: string;
}>;

function formatStatistic(value: number | null): string {
  return value === null ? "—" : STATISTIC_FORMATTER.format(value);
}

async function writeClipboard(text: string, html: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard access is unavailable");
  }
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

function WorkbookViewer({
  appearance,
  controlSetting,
  format,
  metadata,
  onAppearanceChange,
  onControls,
  session,
  title,
}: Readonly<{
  appearance: SpreadsheetAppearance;
  controlSetting: ViewerControlSetting;
  format: "csv" | "xlsx";
  metadata: SpreadsheetWorkbookMetadata;
  onAppearanceChange: (appearance: SpreadsheetAppearance) => void;
  onControls?: ((controls: ViewerControls | null) => void) | undefined;
  session: SpreadsheetViewerReadSession;
  title?: string;
}>) {
  const visibleSheets = metadata.sheets.filter((sheet) => !sheet.hidden);
  const [activeSheetId, setActiveSheetId] = useState(visibleSheets[0]?.id ?? "");
  const [activeCell, setActiveCell] = useState<SpreadsheetCell | undefined>();
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [localSizes, setLocalSizes] = useState<ReadonlyMap<string, LocalSheetSizes>>(new Map());
  const [query, setQuery] = useState("");
  const [reveal, setReveal] = useState<Readonly<{
    column: number;
    row: number;
    token: number;
  }> | null>(null);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchMatches, setSearchMatches] = useState<ReadonlyArray<SpreadsheetSearchMatch>>([]);
  const [selection, setSelection] = useState<SpreadsheetSelection>(INITIAL_SPREADSHEET_SELECTION);
  const [statistics, setStatistics] = useState<SpreadsheetSelectionStatistics>(EMPTY_STATISTICS);
  const [zoom, setZoom] = useState(1);
  const activeSheet = visibleSheets.find((sheet) => sheet.id === activeSheetId) ?? visibleSheets[0];
  const activeSheetReadId = activeSheet?.id ?? "";
  const activeRange = activeSelectionRange(selection);
  const sizes = activeSheet
    ? (localSizes.get(activeSheet.id) ?? { columns: new Map(), rows: new Map() })
    : { columns: new Map(), rows: new Map() };

  useEffect(() => {
    if (!activeSheetReadId) return;
    let cancelled = false;
    setActiveCell(undefined);
    void session
      .readRange(activeSheetReadId, {
        bottom: activeRange.focusRow,
        left: activeRange.focusColumn,
        right: activeRange.focusColumn,
        top: activeRange.focusRow,
      })
      .then((read) => {
        if (!cancelled) setActiveCell(read.cells[0]);
      })
      .catch(() => {
        if (!cancelled) setActiveCell(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRange.focusColumn, activeRange.focusRow, activeSheetReadId, session]);

  useEffect(() => {
    if (!activeSheetReadId) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void session
        .selectionStatistics(activeSheetReadId, normalizedSelectionRanges(selection))
        .then((next) => {
          if (!cancelled) setStatistics(next);
        })
        .catch(() => {
          if (!cancelled) setStatistics(EMPTY_STATISTICS);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeSheetReadId, selection, session]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void session
        .search(query)
        .then((result) => {
          if (cancelled) return;
          setSearchMatches(result.matches);
          setSearchIndex(-1);
        })
        .catch(() => {
          if (!cancelled) {
            setSearchMatches([]);
            setSearchIndex(-1);
          }
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [query, session]);

  const showSearchMatch = (nextIndex: number) => {
    if (searchMatches.length === 0) return;
    const bounded = (nextIndex + searchMatches.length) % searchMatches.length;
    const match = searchMatches[bounded];
    if (!match) return;
    setSearchIndex(bounded);
    setActiveSheetId(match.sheetId);
    setSelection({
      activeRangeIndex: 0,
      ranges: [createSpreadsheetSelectionRange(match.row, match.column)],
    });
    setReveal((previous) => ({
      column: match.column,
      row: match.row,
      token: (previous?.token ?? 0) + 1,
    }));
  };

  const copySelection = () => {
    if (!activeSheet) return;
    void session
      .copy(activeSheet.id, normalizedSelectionRanges(selection))
      .then(async (result) => {
        await writeClipboard(result.text, result.html);
        setCopyNotice(result.truncated ? "Copied the first 100,000 cells" : "Copied selection");
      })
      .catch((cause: unknown) =>
        setCopyNotice(cause instanceof Error ? cause.message : "The selection could not be copied"),
      );
  };

  const resizeAxis = (axis: "column" | "row", index: number, size: number) => {
    if (!activeSheet) return;
    setLocalSizes((previous) => {
      const sheetSizes = previous.get(activeSheet.id) ?? { columns: new Map(), rows: new Map() };
      const axisSizes = new Map(sheetSizes[axis === "column" ? "columns" : "rows"]);
      axisSizes.set(index, size);
      const nextSheetSizes = {
        ...sheetSizes,
        [axis === "column" ? "columns" : "rows"]: axisSizes,
      };
      return new Map(previous).set(activeSheet.id, nextSheetSizes);
    });
  };

  const autoFit = (axis: "column" | "row", index: number) => {
    if (!activeSheet) return;
    void session
      .suggestAxisSize(activeSheet.id, axis, index)
      .then((size) => resizeAxis(axis, index, size))
      .catch((cause: unknown) =>
        setCopyNotice(cause instanceof Error ? cause.message : "Auto-fit failed"),
      );
  };

  const hyperlink = cellHyperlink(activeCell);
  const setBoundedZoom = (value: number) => setZoom(Math.max(0.5, Math.min(2, value)));
  const viewerControls: ViewerControls = {
    actions: [
      { icon: "copy", id: "copy", label: "Copy selection", run: copySelection },
      {
        icon: appearance === "light" ? "dark" : "light",
        id: "appearance",
        label: appearance === "light" ? "Use dark sheet" : "Use light sheet",
        pressed: appearance === "dark",
        run: () => onAppearanceChange(appearance === "light" ? "dark" : "light"),
      },
    ],
    details: {
      activeCell: { address: selectionAddress(selection), value: formulaBarValue(activeCell) },
      appearance,
      hyperlink,
      selectionStatistics: statistics,
    },
    format,
    search: {
      current: searchIndex < 0 ? 0 : searchIndex + 1,
      next: () => showSearchMatch(searchIndex + 1),
      pending: false,
      previous: () => showSearchMatch(searchIndex < 0 ? searchMatches.length - 1 : searchIndex - 1),
      query,
      setQuery,
      total: searchMatches.length,
    },
    status: "ready",
    ...(title === undefined ? {} : { title }),
    zoom: {
      max: 2,
      min: 0.5,
      reset: () => setZoom(1),
      set: setBoundedZoom,
      step: 0.1,
      value: zoom,
      zoomIn: () => setBoundedZoom(zoom + 0.1),
      zoomOut: () => setBoundedZoom(zoom - 0.1),
    },
  };

  if (!activeSheet) return <div role="alert">This workbook has no visible worksheets.</div>;

  return (
    <div
      data-spreadsheet-appearance={appearance}
      style={{
        background: appearance === "dark" ? "#1E1E1E" : "#FFFFFF",
        color: appearance === "dark" ? "#F5F5F5" : "#171717",
        colorScheme: appearance,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <ViewerControlRegion controls={viewerControls} onControls={onControls} setting={controlSetting} />
      <div
        style={{
          alignItems: "center",
          borderBottom: "1px solid color-mix(in srgb, currentColor 12%, transparent)",
          display: "flex",
          flex: "0 0 auto",
          gap: 8,
          minHeight: 32,
          minWidth: 0,
          padding: "4px 8px",
        }}
      >
        <span aria-label="Active cell" style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, minWidth: 48 }}>{selectionAddress(selection)}</span>
        <span aria-hidden="true" style={{ color: "color-mix(in srgb, currentColor 55%, transparent)", font: "italic 600 12px/1 ui-serif, serif" }}>fx</span>
        <span aria-label="Formula bar" style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={formulaBarValue(activeCell) || undefined}>
          {formulaBarValue(activeCell)}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
        <SpreadsheetErrorBoundary
          fallback={
            <div
              role="alert"
              style={{ display: "grid", height: "100%", placeItems: "center", padding: 24 }}
            >
              {activeSheet.name} could not be displayed. Other worksheets remain available below.
            </div>
          }
          key={activeSheet.id}
          scope="sheet"
        >
          <SheetGrid
            appearance={appearance}
            columnSizes={sizes.columns}
            onAutoFit={autoFit}
            onCopy={copySelection}
            onResize={resizeAxis}
            onSelectionChange={setSelection}
            query={query}
            reveal={reveal}
            rowSizes={sizes.rows}
            selection={selection}
            session={session}
            sheet={activeSheet}
            zoom={zoom}
          />
        </SpreadsheetErrorBoundary>
      </div>
      <WorkbookFooter
        activeSheet={activeSheet}
        notice={copyNotice}
        onSelectSheet={(sheetId) => {
          setActiveSheetId(sheetId);
          setSelection(INITIAL_SPREADSHEET_SELECTION);
          setReveal(null);
        }}
        statistics={statistics}
        visibleSheets={visibleSheets}
      />
    </div>
  );
}

function WorkbookFooter({
  activeSheet,
  notice,
  onSelectSheet,
  statistics,
  visibleSheets,
}: Readonly<{
  activeSheet: SpreadsheetSheetMetadata;
  notice: string | null;
  onSelectSheet: (sheetId: string) => void;
  statistics: SpreadsheetSelectionStatistics;
  visibleSheets: ReadonlyArray<SpreadsheetSheetMetadata>;
}>) {
  return (
    <div
      style={{
        alignItems: "stretch",
        borderTop: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
        display: "flex",
        gridRow: 3,
        minHeight: 34,
        overflow: "hidden",
      }}
    >
      <div
        aria-label="Worksheets"
        role="tablist"
        style={{ display: "flex", flex: 1, gap: 2, overflowX: "auto", padding: "3px 8px 0" }}
      >
        {visibleSheets.map((sheet) => (
          <button
            aria-selected={sheet.id === activeSheet.id}
            key={sheet.id}
            onClick={() => onSelectSheet(sheet.id)}
            role="tab"
            style={{
              background: "transparent",
              border: 0,
              borderBottom:
                sheet.id === activeSheet.id ? "2px solid #2563eb" : "2px solid transparent",
              color: "inherit",
              fontSize: 12,
              padding: "5px 10px",
              whiteSpace: "nowrap",
            }}
            type="button"
          >
            {sheet.name}
          </button>
        ))}
      </div>
      <div
        aria-label="Selection statistics"
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          gap: 12,
          padding: "0 10px",
          fontSize: 12,
        }}
      >
        {notice ? <span aria-live="polite">{notice}</span> : null}
        <span>Count {statistics.count}</span>
        {statistics.numericCount > 0 ? (
          <>
            <span>Sum {formatStatistic(statistics.sum)}</span>
            <span>Average {formatStatistic(statistics.average)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function SpreadsheetViewer({
  appearance: controlledAppearance,
  controls: controlSetting = true,
  defaultAppearance,
  format = "xlsx",
  maxBytes = defaultDocumentLimits.maxBytes,
  maxCells = defaultDocumentLimits.maxSpreadsheetCells,
  onError,
  onControls,
  onAppearanceChange,
  source,
  signal,
  title,
}: SpreadsheetViewerProps) {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [error, setError] = useState<DocumentPlatformError | null>(null);
  const [session, setSession] = useState<SpreadsheetViewerReadSession | null>(null);
  const hostAppearance = useSyncExternalStore(
    subscribeToHostAppearance,
    getHostAppearance,
    getServerAppearance,
  );
  const [appearanceOverride, setAppearanceOverride] = useState<SpreadsheetAppearance | null>(
    defaultAppearance ?? null,
  );
  const appearance = controlledAppearance ?? appearanceOverride ?? hostAppearance;

  useEffect(() => {
    let cancelled = false;
    let openedSession: SpreadsheetViewerReadSession | null = null;
    const abort = () => {
      cancelled = true;
      openedSession?.close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    setError(null);
    setSession(null);
    void createSpreadsheetViewerReadSession(source, format, { maxBytes, maxSpreadsheetCells: maxCells })
      .then((nextSession) => {
        openedSession = nextSession;
        if (cancelled) nextSession.close();
        else setSession(nextSession);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          {
            const nextError = cause instanceof DocumentPlatformError ? cause : new DocumentPlatformError("Unable to open this workbook.", { cause, code: "render-failed", format });
            setError(nextError);
            onErrorRef.current?.(nextError);
          }
      });
    return () => {
      cancelled = true;
      openedSession?.close();
      signal?.removeEventListener("abort", abort);
    };
  }, [format, maxBytes, maxCells, signal, source]);

  if (error)
    return (
      <div
        role="alert"
        style={{ display: "grid", height: "100%", placeItems: "center", padding: 24 }}
      >
        {error.message}
      </div>
    );
  if (!session)
    return (
      <div role="status" style={{ display: "grid", height: "100%", placeItems: "center" }}>
        Opening workbook…
      </div>
    );
  const updateAppearance = (next: SpreadsheetAppearance) => {
    if (controlledAppearance === undefined) setAppearanceOverride(next);
    onAppearanceChange?.(next);
  };
  return (
    <SpreadsheetErrorBoundary scope="workbook">
      <WorkbookViewer
        appearance={appearance}
        controlSetting={controlSetting}
        format={format}
        metadata={session.metadata}
        onAppearanceChange={updateAppearance}
        {...(onControls ? { onControls } : {})}
        session={session}
        {...(title ? { title } : {})}
      />
    </SpreadsheetErrorBoundary>
  );
}

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";

function getHostAppearance(): SpreadsheetAppearance {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark"))
    return "dark";
  if (typeof window !== "undefined" && window.matchMedia?.(DARK_MODE_QUERY).matches) return "dark";
  return "light";
}

function getServerAppearance(): SpreadsheetAppearance {
  return "light";
}

function subscribeToHostAppearance(onStoreChange: () => void) {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const mediaQuery = window.matchMedia?.(DARK_MODE_QUERY);
  const observer =
    typeof MutationObserver === "undefined" ? null : new MutationObserver(onStoreChange);
  observer?.observe(document.documentElement, { attributeFilter: ["class"], attributes: true });
  mediaQuery?.addEventListener("change", onStoreChange);
  return () => {
    observer?.disconnect();
    mediaQuery?.removeEventListener("change", onStoreChange);
  };
}
