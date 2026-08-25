import type { SpreadsheetAxis } from "./model.js";

const axisLayoutCache = new WeakMap<SpreadsheetAxis, Map<string, SpreadsheetAxisLayout>>();

export type SpreadsheetAxisKind = "column" | "row";

export type SpreadsheetAxisLayout = Readonly<{
  count: number;
  defaultSize: number;
  overrideIndexes: ReadonlyArray<number>;
  overrideSizes: ReadonlyMap<number, number>;
  prefixDeltas: ReadonlyArray<number>;
  totalSize: number;
}>;

export type SpreadsheetAxisItem = Readonly<{
  index: number;
  size: number;
  start: number;
}>;

function lowerBound(values: ReadonlyArray<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function spreadsheetAxisValueToPixels(value: number, kind: SpreadsheetAxisKind): number {
  if (kind === "column") return Math.max(0, Math.min(Math.floor(value * 7 + 5), 1_800));
  return Math.max(0, Math.min((value * 96) / 72, 546));
}

export function createSpreadsheetAxisLayout(
  axis: SpreadsheetAxis,
  count: number,
  kind: SpreadsheetAxisKind,
  localSizes: ReadonlyMap<number, number> = new Map(),
): SpreadsheetAxisLayout {
  const cacheKey = `${kind}:${count}`;
  const cached = localSizes.size === 0 ? axisLayoutCache.get(axis)?.get(cacheKey) : undefined;
  if (cached) return cached;
  const defaultSize = spreadsheetAxisValueToPixels(axis.defaultSize, kind);
  const indexes = new Set([...axis.sizes.keys(), ...axis.hidden, ...localSizes.keys()]);
  const overrideIndexes = [...indexes]
    .filter((index) => index >= 1 && index <= count)
    .sort((left, right) => left - right);
  const overrideSizes = new Map<number, number>();
  const prefixDeltas: number[] = [];
  let delta = 0;
  for (const index of overrideIndexes) {
    const size = axis.hidden.has(index)
      ? 0
      : (localSizes.get(index) ??
        spreadsheetAxisValueToPixels(axis.sizes.get(index) ?? axis.defaultSize, kind));
    overrideSizes.set(index, size);
    delta += size - defaultSize;
    prefixDeltas.push(delta);
  }
  const layout = {
    count,
    defaultSize,
    overrideIndexes,
    overrideSizes,
    prefixDeltas,
    totalSize: count * defaultSize + delta,
  };
  if (localSizes.size === 0) {
    const entries = axisLayoutCache.get(axis) ?? new Map<string, SpreadsheetAxisLayout>();
    entries.set(cacheKey, layout);
    axisLayoutCache.set(axis, entries);
  }
  return layout;
}

/** Returns the unzoomed logical offset before a zero-based item index. */
export function spreadsheetAxisOffset(layout: SpreadsheetAxisLayout, index: number): number {
  const boundedIndex = Math.max(0, Math.min(layout.count, index));
  const overridesBefore = lowerBound(layout.overrideIndexes, boundedIndex + 1);
  const delta = overridesBefore === 0 ? 0 : (layout.prefixDeltas[overridesBefore - 1] ?? 0);
  return boundedIndex * layout.defaultSize + delta;
}

export function spreadsheetAxisSize(layout: SpreadsheetAxisLayout, index: number): number {
  return layout.overrideSizes.get(index + 1) ?? layout.defaultSize;
}

export function spreadsheetAxisRangeSize(
  layout: SpreadsheetAxisLayout,
  startIndex: number,
  endIndexExclusive: number,
): number {
  return (
    spreadsheetAxisOffset(layout, endIndexExclusive) - spreadsheetAxisOffset(layout, startIndex)
  );
}

export function findSpreadsheetAxisIndex(
  layout: SpreadsheetAxisLayout,
  logicalOffset: number,
): number {
  const target = Math.max(0, Math.min(layout.totalSize, logicalOffset));
  let low = 0;
  let high = Math.max(0, layout.count - 1);
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (spreadsheetAxisOffset(layout, middle) <= target) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function getSpreadsheetAxisItems({
  frozenCount,
  layout,
  logicalOffset,
  overscan,
  viewportSize,
}: Readonly<{
  frozenCount: number;
  layout: SpreadsheetAxisLayout;
  logicalOffset: number;
  overscan: number;
  viewportSize: number;
}>): ReadonlyArray<SpreadsheetAxisItem> {
  if (layout.count === 0) return [];
  const firstVisible = findSpreadsheetAxisIndex(layout, logicalOffset);
  const lastVisible = findSpreadsheetAxisIndex(layout, logicalOffset + Math.max(0, viewportSize));
  const indexes = new Set<number>();
  const boundedFrozenCount = Math.min(Math.max(0, frozenCount), layout.count);
  for (let index = 0; index < boundedFrozenCount; index += 1) indexes.add(index);
  for (
    let index = Math.max(boundedFrozenCount, firstVisible - overscan);
    index <= Math.min(layout.count - 1, lastVisible + overscan);
    index += 1
  ) {
    indexes.add(index);
  }
  const items: SpreadsheetAxisItem[] = [];
  for (const index of [...indexes].sort((left, right) => left - right)) {
    const item = {
      index,
      size: spreadsheetAxisSize(layout, index),
      start: spreadsheetAxisOffset(layout, index),
    };
    if (item.size > 0) items.push(item);
  }
  return items;
}
