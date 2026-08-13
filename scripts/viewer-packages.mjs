export const publicViewerPackageDirectories = Object.freeze([
  "packages/contracts",
  "packages/viewer-ui",
  "packages/spreadsheet-engine",
  "packages/spreadsheet-viewer",
  "packages/presentation-viewer",
  "packages/react-viewer",
  "packages/ingestion",
  "packages/platform",
  "packages/convex",
]);

export const platformConsumerPackageDirectories = Object.freeze(
  publicViewerPackageDirectories.filter((directory) => directory !== "packages/convex"),
);
