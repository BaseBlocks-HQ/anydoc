import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import {
  cellAddress,
  cellKey,
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
} from "./coordinates.js";
import type {
  SpreadsheetCell,
  SpreadsheetCheckbox,
  SpreadsheetMerge,
  SpreadsheetRange,
  SpreadsheetRenderedChart,
  SpreadsheetSheetMetadata,
} from "./model.js";

import {
  createSpreadsheetAxisLayout,
  getSpreadsheetAxisItems,
  spreadsheetAxisOffset,
  spreadsheetAxisRangeSize,
  spreadsheetAxisSize,
  type SpreadsheetAxisItem,
  type SpreadsheetAxisLayout,
} from "./axis-layout.ts";
import type { SpreadsheetViewerReadSession } from "./read-session.ts";
import {
  MAX_BROWSER_SCROLL_SIZE,
  createSpreadsheetScrollProjection,
  projectSpreadsheetItemStart,
  type SpreadsheetScrollProjection,
} from "./scroll-projection.ts";
import { useSpreadsheetGridViewport } from "./use-grid-viewport.ts";
import { createSpreadsheetViewerExtent, tileSpreadsheetViewerRange } from "./viewport-model.ts";
import {
  activeSelectionRange,
  cellHyperlink,
  createSpreadsheetSelectionRange,
  displayCellValue,
  replaceActiveSelectionRange,
  selectSpreadsheetRange,
  selectionContains,
  selectionEdges,
  selectionIntersectsColumn,
  selectionIntersectsRow,
  type SpreadsheetSelection,
  type SpreadsheetSelectionKind,
} from "./viewer-model.ts";

const COLUMN_HEADER_HEIGHT = 28;
const ROW_HEADER_WIDTH = 52;

function LazyNativeChart({
  chart,
  height,
  width,
}: Readonly<{
  chart: SpreadsheetRenderedChart;
  height: number;
  width: number;
}>) {
  const [NativeChart, setNativeChart] = useState<
    (typeof import("./native-chart.tsx"))["NativeChart"] | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    import("./native-chart.tsx")
      .then((module) => {
        if (!cancelled) setNativeChart(() => module.NativeChart);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return NativeChart ? <NativeChart chart={chart} height={height} width={width} /> : null;
}

type AxisResize = Readonly<{
  axis: "column" | "row";
  index: number;
  initialPointer: number;
  initialSize: number;
}>;

function itemForIndex(layout: SpreadsheetAxisLayout, index: number): SpreadsheetAxisItem {
  return {
    index,
    size: spreadsheetAxisSize(layout, index),
    start: spreadsheetAxisOffset(layout, index),
  };
}

function includeMergeAnchors(
  rows: ReadonlyArray<SpreadsheetAxisItem>,
  columns: ReadonlyArray<SpreadsheetAxisItem>,
  merges: ReadonlyArray<SpreadsheetMerge>,
  rowLayout: SpreadsheetAxisLayout,
  columnLayout: SpreadsheetAxisLayout,
) {
  const rowIndexes = new Set(rows.map((item) => item.index));
  const columnIndexes = new Set(columns.map((item) => item.index));
  const firstRow = rows.at(0)?.index ?? 0;
  const lastRow = rows.at(-1)?.index ?? 0;
  const firstColumn = columns.at(0)?.index ?? 0;
  const lastColumn = columns.at(-1)?.index ?? 0;
  for (const merge of merges) {
    const intersects =
      merge.bottom - 1 >= firstRow &&
      merge.top - 1 <= lastRow &&
      merge.right - 1 >= firstColumn &&
      merge.left - 1 <= lastColumn &&
      rows.some((row) => row.index + 1 >= merge.top && row.index + 1 <= merge.bottom) &&
      columns.some((column) => column.index + 1 >= merge.left && column.index + 1 <= merge.right);
    if (!intersects) continue;
    rowIndexes.add(merge.top - 1);
    columnIndexes.add(merge.left - 1);
  }
  const visibleColumns: SpreadsheetAxisItem[] = [];
  for (const index of [...columnIndexes].sort((left, right) => left - right)) {
    const item = itemForIndex(columnLayout, index);
    if (item.size > 0) visibleColumns.push(item);
  }
  const visibleRows: SpreadsheetAxisItem[] = [];
  for (const index of [...rowIndexes].sort((left, right) => left - right)) {
    const item = itemForIndex(rowLayout, index);
    if (item.size > 0) visibleRows.push(item);
  }
  return { columns: visibleColumns, rows: visibleRows };
}

function contiguousIntervals(items: ReadonlyArray<SpreadsheetAxisItem>) {
  const intervals: Array<{ end: number; start: number }> = [];
  for (const item of items) {
    const index = item.index + 1;
    const previous = intervals.at(-1);
    if (previous && previous.end + 1 === index) previous.end = index;
    else intervals.push({ end: index, start: index });
  }
  return intervals;
}

function visibleRanges(
  rows: ReadonlyArray<SpreadsheetAxisItem>,
  columns: ReadonlyArray<SpreadsheetAxisItem>,
  rowCount: number,
  columnCount: number,
): ReadonlyArray<SpreadsheetRange> {
  const ranges = new Map<string, SpreadsheetRange>();
  for (const row of contiguousIntervals(rows)) {
    for (const column of contiguousIntervals(columns)) {
      const range = tileSpreadsheetViewerRange(
        {
          bottom: row.end,
          left: column.start,
          right: column.end,
          top: row.start,
        },
        { columns: columnCount, rows: rowCount },
      );
      ranges.set(`${range.top}:${range.left}:${range.bottom}:${range.right}`, range);
    }
  }
  return [...ranges.values()];
}

function rangesFromKey(key: string): ReadonlyArray<SpreadsheetRange> {
  if (!key) return [];
  return key.split("|").map((encoded) => {
    const [top, left, bottom, right] = encoded.split(":").map(Number);
    return { bottom: bottom!, left: left!, right: right!, top: top! };
  });
}

const visibleMergeCache = new WeakMap<
  ReadonlyArray<SpreadsheetMerge>,
  Map<string, ReadonlyMap<string, SpreadsheetMerge>>
>();

function visibleMergeLookup(
  merges: ReadonlyArray<SpreadsheetMerge>,
  rows: ReadonlyArray<SpreadsheetAxisItem>,
  columns: ReadonlyArray<SpreadsheetAxisItem>,
): ReadonlyMap<string, SpreadsheetMerge> {
  const cacheKey = `${rows.map((row) => row.index).join(",")}|${columns.map((column) => column.index).join(",")}`;
  const cache = visibleMergeCache.get(merges) ?? new Map();
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const lookup = new Map<string, SpreadsheetMerge>();
  for (const merge of merges) {
    const matchingRows = rows.filter(
      (row) => row.index + 1 >= merge.top && row.index + 1 <= merge.bottom,
    );
    if (matchingRows.length === 0) continue;
    const matchingColumns = columns.filter(
      (column) => column.index + 1 >= merge.left && column.index + 1 <= merge.right,
    );
    for (const row of matchingRows) {
      for (const column of matchingColumns) {
        lookup.set(cellKey(row.index + 1, column.index + 1), merge);
      }
    }
  }
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, lookup);
  visibleMergeCache.set(merges, cache);
  return lookup;
}

function projectedStart(
  frozen: boolean,
  item: SpreadsheetAxisItem,
  projection: SpreadsheetScrollProjection,
  zoom: number,
): number {
  return frozen
    ? projection.physicalOffset + item.start * zoom
    : projectSpreadsheetItemStart(projection, item.start * zoom);
}

function cellStyle(
  cell: SpreadsheetCell | undefined,
  matched: boolean,
  selected: boolean,
): CSSProperties {
  const style = cell?.style;
  const background = style?.background ?? "var(--spreadsheet-canvas)";
  return {
    alignItems:
      style?.vertical === "top"
        ? "flex-start"
        : style?.vertical === "middle"
          ? "center"
          : "flex-end",
    background: matched
      ? "#FEF08A"
      : selected
        ? `color-mix(in srgb, var(--spreadsheet-selection) 18%, ${background})`
        : background,
    color: matched ? "#422006" : (style?.color ?? "var(--spreadsheet-foreground)"),
    fontFamily: style?.fontFamily ?? "inherit",
    fontSize: style?.fontSize,
    fontStyle: style?.italic ? "italic" : undefined,
    fontWeight: style?.bold ? 700 : undefined,
    justifyContent:
      style?.horizontal === "center"
        ? "center"
        : style?.horizontal === "right"
          ? "flex-end"
          : "flex-start",
    textAlign: style?.horizontal,
    textDecoration: style?.underline ? "underline" : undefined,
    whiteSpace: style?.wrapText ? "normal" : "nowrap",
  };
}

function checkboxAccessibleLabel(checkbox: SpreadsheetCheckbox): string {
  return `${checkbox.checked ? "Checked" : "Unchecked"} checkbox${checkbox.caption ? `: ${checkbox.caption}` : ""}`;
}

function selectionBoxShadow(edges: ReturnType<typeof selectionEdges>): CSSProperties["boxShadow"] {
  if (!edges) return undefined;
  const shadows: string[] = [];
  if (edges.top) shadows.push("inset 0 2px 0 var(--spreadsheet-selection)");
  if (edges.right) shadows.push("inset -2px 0 0 var(--spreadsheet-selection)");
  if (edges.bottom) shadows.push("inset 0 -2px 0 var(--spreadsheet-selection)");
  if (edges.left) shadows.push("inset 2px 0 0 var(--spreadsheet-selection)");
  return shadows.join(", ") || undefined;
}

function physicalOffsetForLogical(
  logicalOffset: number,
  projection: SpreadsheetScrollProjection,
  viewportSize: number,
): number {
  const logicalScrollable = Math.max(0, projection.logicalSize - viewportSize);
  const physicalScrollable = Math.max(0, projection.physicalSize - viewportSize);
  if (logicalScrollable === 0) return 0;
  return (
    (Math.max(0, Math.min(logicalScrollable, logicalOffset)) / logicalScrollable) *
    physicalScrollable
  );
}

function columnHeaderStyle(
  column: SpreadsheetAxisItem,
  frozenColumns: number,
  projection: SpreadsheetScrollProjection,
  zoom: number,
): CSSProperties {
  return {
    alignItems: "center",
    background: "var(--spreadsheet-header)",
    borderBottom: "1px solid var(--spreadsheet-grid)",
    borderRight: "1px solid var(--spreadsheet-grid)",
    boxSizing: "border-box",
    color: "var(--spreadsheet-header-foreground)",
    display: "flex",
    fontSize: 12,
    height: COLUMN_HEADER_HEIGHT,
    justifyContent: "center",
    left: projectedStart(column.index < frozenColumns, column, projection, zoom) + ROW_HEADER_WIDTH,
    position: "absolute",
    top: 0,
    userSelect: "none",
    width: column.size * zoom,
  };
}

function rowHeaderStyle(
  row: SpreadsheetAxisItem,
  frozenRows: number,
  projection: SpreadsheetScrollProjection,
  zoom: number,
): CSSProperties {
  return {
    alignItems: "center",
    background: "var(--spreadsheet-header)",
    borderBottom: "1px solid var(--spreadsheet-grid)",
    borderRight: "1px solid var(--spreadsheet-grid)",
    boxSizing: "border-box",
    color: "var(--spreadsheet-header-foreground)",
    display: "flex",
    fontSize: 12,
    height: row.size * zoom,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    top: projectedStart(row.index < frozenRows, row, projection, zoom) + COLUMN_HEADER_HEIGHT,
    userSelect: "none",
    width: ROW_HEADER_WIDTH,
  };
}

function nextSelection(
  event: KeyboardEvent,
  selection: SpreadsheetSelection,
  usedRange: SpreadsheetRange | null,
  visibleRowCount: number,
  rowCount: number,
  columnCount: number,
) {
  const active = activeSelectionRange(selection);
  let row = active.focusRow;
  let column = active.focusColumn;
  const modifier = event.metaKey || event.ctrlKey;
  if (event.key === "ArrowDown") row = modifier ? (usedRange?.bottom ?? XLSX_MAX_ROWS) : row + 1;
  else if (event.key === "ArrowUp") row = modifier ? 1 : row - 1;
  else if (event.key === "ArrowRight" || event.key === "Tab") {
    column = modifier
      ? (usedRange?.right ?? XLSX_MAX_COLUMNS)
      : column + (event.shiftKey && event.key === "Tab" ? -1 : 1);
  } else if (event.key === "ArrowLeft") column = modifier ? 1 : column - 1;
  else if (event.key === "Enter") row += event.shiftKey ? -1 : 1;
  else if (event.key === "Home") {
    column = 1;
    if (modifier) row = 1;
  } else if (event.key === "End") {
    column = usedRange?.right ?? column;
    if (modifier) row = usedRange?.bottom ?? row;
  } else if (event.key === "PageDown") row += Math.max(1, visibleRowCount - 2);
  else if (event.key === "PageUp") row -= Math.max(1, visibleRowCount - 2);
  else return null;
  row = Math.max(1, Math.min(rowCount, row));
  column = Math.max(1, Math.min(columnCount, column));
  const range =
    event.shiftKey && event.key !== "Tab"
      ? {
          ...active,
          focusColumn: column,
          focusRow: row,
          kind: "cells" as const,
        }
      : createSpreadsheetSelectionRange(row, column);
  return event.shiftKey && event.key !== "Tab"
    ? replaceActiveSelectionRange(selection, range)
    : selectSpreadsheetRange(selection, range, false);
}

export function SheetGrid({
  appearance,
  columnSizes,
  onAutoFit,
  onCopy,
  onResize,
  onSelectionChange,
  query,
  reveal,
  rowSizes,
  selection,
  session,
  sheet,
  zoom,
}: Readonly<{
  appearance: "dark" | "light";
  columnSizes: ReadonlyMap<number, number>;
  onAutoFit: (axis: "column" | "row", index: number) => void;
  onCopy: () => void;
  onResize: (axis: "column" | "row", index: number, size: number) => void;
  onSelectionChange: (selection: SpreadsheetSelection) => void;
  query: string;
  reveal: Readonly<{ column: number; row: number; token: number }> | null;
  rowSizes: ReadonlyMap<number, number>;
  selection: SpreadsheetSelection;
  session: SpreadsheetViewerReadSession;
  sheet: SpreadsheetSheetMetadata;
  zoom: number;
}>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragSelection = useRef<SpreadsheetSelectionKind | null>(null);
  const resize = useRef<AxisResize | null>(null);
  const [cells, setCells] = useState<ReadonlyMap<string, SpreadsheetCell>>(new Map());
  const [charts, setCharts] = useState<readonly SpreadsheetRenderedChart[]>([]);
  const [readError, setReadError] = useState<Error | null>(null);
  const extent = createSpreadsheetViewerExtent(sheet);
  const rowLayout = createSpreadsheetAxisLayout(sheet.rows, extent.rows, "row", rowSizes);
  const columnLayout = createSpreadsheetAxisLayout(
    sheet.columns,
    extent.columns,
    "column",
    columnSizes,
  );
  const viewport = useSpreadsheetGridViewport(
    scrollRef,
    sheet.frozenColumns > 0 || columnLayout.totalSize * zoom > MAX_BROWSER_SCROLL_SIZE
      ? 1
      : Math.max(1, Math.floor(columnLayout.defaultSize * zoom)),
    sheet.frozenRows > 0 || rowLayout.totalSize * zoom > MAX_BROWSER_SCROLL_SIZE
      ? 1
      : Math.max(1, Math.floor(rowLayout.defaultSize * zoom)),
  );
  const bodyHeight = Math.max(0, viewport.height - COLUMN_HEADER_HEIGHT);
  const bodyWidth = Math.max(0, viewport.width - ROW_HEADER_WIDTH);
  const rowProjection = createSpreadsheetScrollProjection({
    logicalSize: rowLayout.totalSize * zoom,
    physicalOffset: viewport.scrollTop,
    viewportSize: bodyHeight,
  });
  const columnProjection = createSpreadsheetScrollProjection({
    logicalSize: columnLayout.totalSize * zoom,
    physicalOffset: viewport.scrollLeft,
    viewportSize: bodyWidth,
  });
  const visible = includeMergeAnchors(
    getSpreadsheetAxisItems({
      frozenCount: sheet.frozenRows,
      layout: rowLayout,
      logicalOffset: rowProjection.logicalOffset / zoom,
      overscan: 8,
      viewportSize: bodyHeight / zoom,
    }),
    getSpreadsheetAxisItems({
      frozenCount: sheet.frozenColumns,
      layout: columnLayout,
      logicalOffset: columnProjection.logicalOffset / zoom,
      overscan: 4,
      viewportSize: bodyWidth / zoom,
    }),
    sheet.merges,
    rowLayout,
    columnLayout,
  );
  const mergeLookup = visibleMergeLookup(sheet.merges, visible.rows, visible.columns);
  const ranges = visibleRanges(visible.rows, visible.columns, extent.rows, extent.columns);
  const rangeKey = ranges
    .map((range) => `${range.top}:${range.left}:${range.bottom}:${range.right}`)
    .join("|");
  const checkboxLookup = new Map<string, SpreadsheetCheckbox[]>();
  for (const checkbox of sheet.checkboxes ?? []) {
    const key = cellKey(checkbox.row, checkbox.column);
    const existing = checkboxLookup.get(key);
    if (existing) existing.push(checkbox);
    else checkboxLookup.set(key, [checkbox]);
  }

  useEffect(() => {
    let cancelled = false;
    setReadError(null);
    const requestedRanges = rangesFromKey(rangeKey);
    if (requestedRanges.length === 0) {
      setCells(new Map());
      return;
    }
    void Promise.all(requestedRanges.map((range) => session.readRange(sheet.id, range)))
      .then((reads) => {
        if (cancelled) return;
        setCells(
          new Map(
            reads.flatMap((read) =>
              read.cells.map((cell) => [cellKey(cell.row, cell.column), cell]),
            ),
          ),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setReadError(
            cause instanceof Error
              ? cause
              : new Error("The visible worksheet range failed to load."),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey, session, sheet.id]);

  useEffect(() => {
    let cancelled = false;
    void session.readCharts(sheet.id).then((next) => {
      if (!cancelled) setCharts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [session, sheet.id]);

  const dispatchResize = useEffectEvent((axis: "column" | "row", index: number, size: number) =>
    onResize(axis, index, size),
  );

  useEffect(() => {
    const endPointerAction = () => {
      dragSelection.current = null;
      resize.current = null;
    };
    const moveResize = (event: globalThis.PointerEvent) => {
      const activeResize = resize.current;
      if (!activeResize) return;
      const pointer = activeResize.axis === "column" ? event.clientX : event.clientY;
      dispatchResize(
        activeResize.axis,
        activeResize.index,
        Math.max(
          activeResize.axis === "column" ? 24 : 18,
          activeResize.initialSize + (pointer - activeResize.initialPointer) / zoom,
        ),
      );
    };
    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", endPointerAction);
    window.addEventListener("pointercancel", endPointerAction);
    return () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", endPointerAction);
      window.removeEventListener("pointercancel", endPointerAction);
    };
  }, [zoom]);

  const revealCell = useEffectEvent(
    (target: Readonly<{ column: number; row: number; token: number }>) => {
      const element = scrollRef.current;
      if (!element) return;
      const rowStart = spreadsheetAxisOffset(rowLayout, target.row - 1) * zoom;
      const columnStart = spreadsheetAxisOffset(columnLayout, target.column - 1) * zoom;
      element.scrollTop = physicalOffsetForLogical(
        Math.max(0, rowStart - bodyHeight / 2),
        rowProjection,
        bodyHeight,
      );
      element.scrollLeft = physicalOffsetForLogical(
        Math.max(0, columnStart - bodyWidth / 2),
        columnProjection,
        bodyWidth,
      );
    },
  );

  useEffect(() => {
    if (!reveal) return;
    revealCell(reveal);
  }, [reveal]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const palette =
    appearance === "dark"
      ? {
          canvas: "#1E1E1E",
          foreground: "#F5F5F5",
          grid: "#4A4A4A",
          header: "#252526",
          headerForeground: "#C9C9C9",
          selection: "#60A5FA",
        }
      : {
          canvas: "#FFFFFF",
          foreground: "#171717",
          grid: "#D4D4D4",
          header: "#F3F3F3",
          headerForeground: "#5F5F5F",
          selection: "#2563EB",
        };

  const beginSelection = (
    row: number,
    column: number,
    kind: SpreadsheetSelectionKind,
    event: PointerEvent,
  ) => {
    event.preventDefault();
    const active = activeSelectionRange(selection);
    const next = event.shiftKey
      ? replaceActiveSelectionRange(selection, {
          ...active,
          focusColumn: column,
          focusRow: row,
          kind,
        })
      : selectSpreadsheetRange(
          selection,
          createSpreadsheetSelectionRange(row, column, kind),
          event.metaKey || event.ctrlKey,
        );
    dragSelection.current = kind;
    onSelectionChange(next);
    scrollRef.current?.focus({ preventScroll: true });
  };
  const extendDrag = (row: number, column: number, kind: SpreadsheetSelectionKind) => {
    if (dragSelection.current !== kind) return;
    const active = activeSelectionRange(selection);
    onSelectionChange(
      replaceActiveSelectionRange(selection, {
        ...active,
        focusColumn: column,
        focusRow: row,
      }),
    );
  };
  const beginResize = (
    axis: "column" | "row",
    index: number,
    size: number,
    event: PointerEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resize.current = {
      axis,
      index,
      initialPointer: axis === "column" ? event.clientX : event.clientY,
      initialSize: size,
    };
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "c") {
      event.preventDefault();
      onCopy();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "a") {
      event.preventDefault();
      onSelectionChange({
        activeRangeIndex: 0,
        ranges: [createSpreadsheetSelectionRange(1, 1, "all")],
      });
      return;
    }
    if (event.key === " " && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      const active = activeSelectionRange(selection);
      onSelectionChange({
        activeRangeIndex: 0,
        ranges: [
          createSpreadsheetSelectionRange(
            active.focusRow,
            active.focusColumn,
            event.shiftKey ? "rows" : "columns",
          ),
        ],
      });
      return;
    }
    if (event.key === "Escape" && selection.ranges.length > 1) {
      event.preventDefault();
      const active = activeSelectionRange(selection);
      onSelectionChange({ activeRangeIndex: 0, ranges: [active] });
      return;
    }
    const next = nextSelection(
      event,
      selection,
      sheet.usedRange,
      visible.rows.length,
      extent.rows,
      extent.columns,
    );
    if (!next) return;
    event.preventDefault();
    onSelectionChange(next);
    const active = activeSelectionRange(next);
    const element = scrollRef.current;
    if (!element) return;
    const rowStart = spreadsheetAxisOffset(rowLayout, active.focusRow - 1) * zoom;
    const columnStart = spreadsheetAxisOffset(columnLayout, active.focusColumn - 1) * zoom;
    element.scrollTop = physicalOffsetForLogical(
      Math.max(0, rowStart - bodyHeight / 2),
      rowProjection,
      bodyHeight,
    );
    element.scrollLeft = physicalOffsetForLogical(
      Math.max(0, columnStart - bodyWidth / 2),
      columnProjection,
      bodyWidth,
    );
  };

  if (readError) {
    return (
      <div role="alert" style={{ display: "grid", height: "100%", placeItems: "center" }}>
        {readError.message}
      </div>
    );
  }

  return (
    <div
      aria-colcount={extent.columns}
      aria-label={sheet.name}
      aria-rowcount={extent.rows}
      onKeyDown={onKeyDown}
      ref={scrollRef}
      role="grid"
      style={
        {
          "--spreadsheet-canvas": palette.canvas,
          "--spreadsheet-foreground": palette.foreground,
          "--spreadsheet-grid": palette.grid,
          "--spreadsheet-header": palette.header,
          "--spreadsheet-header-foreground": palette.headerForeground,
          "--spreadsheet-selection": palette.selection,
          background: palette.canvas,
          color: palette.foreground,
          height: "100%",
          overflow: "auto",
          overscrollBehavior: "contain",
          position: "relative",
        } as CSSProperties
      }
      tabIndex={0}
    >
      <div
        style={{
          height: rowProjection.physicalSize + COLUMN_HEADER_HEIGHT,
          position: "relative",
          width: columnProjection.physicalSize + ROW_HEADER_WIDTH,
        }}
      >
        <div
          style={{
            height: 0,
            left: 0,
            position: "sticky",
            top: 0,
            width: 0,
            zIndex: 9,
          }}
        >
          <button
            aria-label="Select all cells"
            onPointerDown={(event) => beginSelection(1, 1, "all", event)}
            style={{
              background: "var(--spreadsheet-header)",
              border: 0,
              borderBottom: "1px solid var(--spreadsheet-grid)",
              borderRight: "1px solid var(--spreadsheet-grid)",
              color: "var(--spreadsheet-header-foreground)",
              height: COLUMN_HEADER_HEIGHT,
              padding: 0,
              position: "absolute",
              width: ROW_HEADER_WIDTH,
            }}
            type="button"
          >
            ◢
          </button>
        </div>
        <div
          style={{
            height: 0,
            position: "sticky",
            top: 0,
            width: "100%",
            zIndex: 7,
          }}
        >
          {visible.columns.map((column) => {
            const columnNumber = column.index + 1;
            const selected = selectionIntersectsColumn(selection, columnNumber);
            return (
              <div
                aria-colindex={columnNumber}
                key={column.index}
                onPointerDown={(event) => beginSelection(1, columnNumber, "columns", event)}
                onPointerEnter={() => extendDrag(1, columnNumber, "columns")}
                role="columnheader"
                style={{
                  ...columnHeaderStyle(column, sheet.frozenColumns, columnProjection, zoom),
                  background: selected
                    ? "color-mix(in srgb, var(--spreadsheet-selection) 22%, var(--spreadsheet-header))"
                    : "var(--spreadsheet-header)",
                }}
              >
                {cellAddress(1, columnNumber).replace(/1$/u, "")}
                <div
                  aria-label={`Resize column ${columnNumber}`}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onAutoFit("column", columnNumber);
                  }}
                  onPointerDown={(event) => beginResize("column", columnNumber, column.size, event)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    onResize(
                      "column",
                      columnNumber,
                      Math.max(24, column.size + (event.key === "ArrowLeft" ? -8 : 8)),
                    );
                  }}
                  role="separator"
                  style={{
                    cursor: "col-resize",
                    height: "100%",
                    position: "absolute",
                    right: -3,
                    touchAction: "none",
                    width: 7,
                    zIndex: 2,
                  }}
                  tabIndex={0}
                />
              </div>
            );
          })}
        </div>
        <div
          style={{
            height: 0,
            left: 0,
            position: "sticky",
            width: 0,
            zIndex: 6,
          }}
        >
          {visible.rows.map((row) => {
            const rowNumber = row.index + 1;
            const selected = selectionIntersectsRow(selection, rowNumber);
            return (
              <div
                aria-rowindex={rowNumber}
                key={row.index}
                onPointerDown={(event) => beginSelection(rowNumber, 1, "rows", event)}
                onPointerEnter={() => extendDrag(rowNumber, 1, "rows")}
                role="rowheader"
                style={{
                  ...rowHeaderStyle(row, sheet.frozenRows, rowProjection, zoom),
                  background: selected
                    ? "color-mix(in srgb, var(--spreadsheet-selection) 22%, var(--spreadsheet-header))"
                    : "var(--spreadsheet-header)",
                }}
              >
                {rowNumber}
                <div
                  aria-label={`Resize row ${rowNumber}`}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onAutoFit("row", rowNumber);
                  }}
                  onPointerDown={(event) => beginResize("row", rowNumber, row.size, event)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    onResize(
                      "row",
                      rowNumber,
                      Math.max(18, row.size + (event.key === "ArrowUp" ? -8 : 8)),
                    );
                  }}
                  role="separator"
                  style={{
                    bottom: -3,
                    cursor: "row-resize",
                    height: 7,
                    left: 0,
                    position: "absolute",
                    touchAction: "none",
                    width: "100%",
                    zIndex: 2,
                  }}
                  tabIndex={0}
                />
              </div>
            );
          })}
        </div>
        {visible.rows.flatMap((row) =>
          visible.columns.map((column) => {
            const rowNumber = row.index + 1;
            const columnNumber = column.index + 1;
            const merge = mergeLookup.get(cellKey(rowNumber, columnNumber));
            if (merge && (merge.top !== rowNumber || merge.left !== columnNumber)) return null;
            const cell = cells.get(cellKey(rowNumber, columnNumber));
            const checkboxes = checkboxLookup.get(cellKey(rowNumber, columnNumber)) ?? [];
            const value = displayCellValue(cell);
            const checkboxValue = checkboxes
              .map((checkbox) => `${checkbox.checked ? "[x]" : "[ ]"}${checkbox.caption ? ` ${checkbox.caption}` : ""}`)
              .join(" ");
            const hyperlink = cellHyperlink(cell);
            const selected = selectionContains(selection, rowNumber, columnNumber);
            const selectedEdges = selectionEdges(selection, rowNumber, columnNumber);
            const matched =
              normalizedQuery.length > 0 &&
              `${value} ${checkboxValue}`.toLocaleLowerCase().includes(normalizedQuery);
            const validation = sheet.dataValidations.find(
              (rule) =>
                rowNumber >= rule.range.top &&
                rowNumber <= rule.range.bottom &&
                columnNumber >= rule.range.left &&
                columnNumber <= rule.range.right,
            );
            const table = sheet.tables.find(
              (candidate) =>
                rowNumber >= candidate.range.top &&
                rowNumber <= candidate.range.bottom &&
                columnNumber >= candidate.range.left &&
                columnNumber <= candidate.range.right,
            );
            const width =
              (merge
                ? spreadsheetAxisRangeSize(columnLayout, merge.left - 1, merge.right)
                : column.size) * zoom;
            const height =
              (merge
                ? spreadsheetAxisRangeSize(rowLayout, merge.top - 1, merge.bottom)
                : row.size) * zoom;
            const address = cellAddress(rowNumber, columnNumber);
            const accessibleValue = [value, checkboxValue].filter(Boolean).join(" ");
            return (
              <button
                aria-colindex={columnNumber}
                aria-label={`${address}: ${accessibleValue || "empty"}`}
                aria-rowindex={rowNumber}
                aria-selected={selected}
                key={`${row.index}:${column.index}`}
                onPointerDown={(event) => beginSelection(rowNumber, columnNumber, "cells", event)}
                onPointerEnter={() => extendDrag(rowNumber, columnNumber, "cells")}
                role="gridcell"
                style={{
                  ...cellStyle(cell, matched, selected),
                  background:
                    table && rowNumber === table.range.top
                      ? (cell?.style.background ?? "#4472C4")
                      : cell?.style.background,
                  color:
                    table && rowNumber === table.range.top
                      ? (cell?.style.color ?? "#FFFFFF")
                      : cell?.style.color,
                  borderBottom: `1px solid ${cell?.style.borderBottom ?? "var(--spreadsheet-grid)"}`,
                  borderLeft: cell?.style.borderLeft
                    ? `1px solid ${cell.style.borderLeft}`
                    : undefined,
                  borderRight: `1px solid ${cell?.style.borderRight ?? "var(--spreadsheet-grid)"}`,
                  borderTop: cell?.style.borderTop
                    ? `1px solid ${cell.style.borderTop}`
                    : undefined,
                  boxShadow: selectionBoxShadow(selectedEdges),
                  boxSizing: "border-box",
                  cursor: hyperlink ? "pointer" : "default",
                  display: "flex",
                  height,
                  left:
                    projectedStart(
                      column.index < sheet.frozenColumns,
                      column,
                      columnProjection,
                      zoom,
                    ) + ROW_HEADER_WIDTH,
                  margin: 0,
                  overflow: "hidden",
                  padding: `${3 * zoom}px ${6 * zoom}px`,
                  position: "absolute",
                  textOverflow: "ellipsis",
                  top:
                    projectedStart(row.index < sheet.frozenRows, row, rowProjection, zoom) +
                    COLUMN_HEADER_HEIGHT,
                  width,
                  zIndex:
                    column.index < sheet.frozenColumns || row.index < sheet.frozenRows
                      ? 4
                      : selected
                        ? 3
                        : 1,
                }}
                type="button"
              >
                {checkboxes.map((checkbox, index) => (
                  <span
                    aria-label={checkboxAccessibleLabel(checkbox)}
                    key={`${checkbox.row}:${checkbox.column}:${index}`}
                    style={{
                      alignItems: "center",
                      display: "inline-flex",
                      flexShrink: 0,
                      gap: 4 * zoom,
                      marginRight: 4 * zoom,
                      maxWidth: "100%",
                    }}
                    title={checkbox.caption || undefined}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        alignItems: "center",
                        border: "1.5px solid currentColor",
                        borderRadius: 2 * zoom,
                        display: "inline-flex",
                        flexShrink: 0,
                        fontSize: 10 * zoom,
                        height: 13 * zoom,
                        justifyContent: "center",
                        lineHeight: 1,
                        width: 13 * zoom,
                      }}
                    >
                      {checkbox.checked ? "✓" : null}
                    </span>
                    {checkbox.caption ? (
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {checkbox.caption}
                      </span>
                    ) : null}
                  </span>
                ))}
                <span
                  style={{
                    color: hyperlink ? "#2563EB" : undefined,
                    textDecoration: hyperlink ? "underline" : undefined,
                  }}
                  title={cell?.hyperlink?.tooltip ?? hyperlink ?? undefined}
                >
                  {value}
                </span>
                {validation ? (
                  <span aria-label="Validated list" style={{ marginLeft: "auto", opacity: 0.7 }}>
                    ▾
                  </span>
                ) : null}
              </button>
            );
          }),
        )}
        {sheet.objects.flatMap((object) => {
          if (!object.chart || object.anchor?.kind !== "two-cell") return [];
          const chart = charts.find(({ chartId }) => chartId === object.chart?.id);
          if (!chart) return [];
          const fromColumn = itemForIndex(columnLayout, object.anchor.from.column - 1);
          const fromRow = itemForIndex(rowLayout, object.anchor.from.row - 1);
          const toColumn = itemForIndex(columnLayout, object.anchor.to.column - 1);
          const toRow = itemForIndex(rowLayout, object.anchor.to.row - 1);
          const left = projectedStart(false, fromColumn, columnProjection, zoom) + ROW_HEADER_WIDTH;
          const top = projectedStart(false, fromRow, rowProjection, zoom) + COLUMN_HEADER_HEIGHT;
          const width = Math.max(120, (toColumn.start - fromColumn.start) * zoom);
          const height = Math.max(90, (toRow.start - fromRow.start) * zoom);
          return (
            <div
              key={object.id}
              style={{
                border: "1px solid var(--spreadsheet-grid)",
                boxShadow: "0 2px 8px rgb(0 0 0 / 18%)",
                height,
                left,
                overflow: "hidden",
                position: "absolute",
                top,
                width,
                zIndex: 5,
              }}
            >
              <LazyNativeChart chart={chart} height={height} width={width} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
