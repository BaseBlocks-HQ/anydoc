export const MAX_BROWSER_SCROLL_SIZE = 8_000_000;

export type SpreadsheetScrollProjection = Readonly<{
  logicalOffset: number;
  logicalSize: number;
  physicalOffset: number;
  physicalSize: number;
}>;

export function createSpreadsheetScrollProjection({
  logicalSize,
  physicalOffset,
  viewportSize,
}: Readonly<{
  logicalSize: number;
  physicalOffset: number;
  viewportSize: number;
}>): SpreadsheetScrollProjection {
  const physicalSize = Math.min(Math.max(viewportSize, logicalSize), MAX_BROWSER_SCROLL_SIZE);
  const logicalScrollable = Math.max(0, logicalSize - viewportSize);
  const physicalScrollable = Math.max(0, physicalSize - viewportSize);
  const boundedPhysicalOffset = Math.max(0, Math.min(physicalScrollable, physicalOffset));
  const logicalOffset =
    physicalScrollable === 0 ? 0 : (boundedPhysicalOffset / physicalScrollable) * logicalScrollable;
  return {
    logicalOffset,
    logicalSize,
    physicalOffset: boundedPhysicalOffset,
    physicalSize,
  };
}

export function projectSpreadsheetItemStart(
  projection: SpreadsheetScrollProjection,
  logicalStart: number,
): number {
  return projection.physicalOffset + logicalStart - projection.logicalOffset;
}
