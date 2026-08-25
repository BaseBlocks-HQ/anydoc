// Headless entry: framework-free document detection, byte loading, security
// primitives, errors, and the spreadsheet read engine. React components live
// behind the ./react subpath.
export { detectViewerFormat, detectViewerFormatFromBytes } from "./detect.js";
export { ViewerError, toViewerError } from "./errors.js";
export type * from "./errors.js";
export { decodeUtf8, loadDocumentBytes } from "./source.js";
export { sanitizeDocxArchive } from "./docx-archive.js";
export type {
  ViewerAction,
  ViewerControlOptions,
  ViewerControls,
  ViewerControlSetting,
  ViewerFormat,
} from "./controls.js";
export type * from "./types.js";
export * from "./spreadsheet/coordinates.js";
export * from "./spreadsheet/model.js";
export * from "./spreadsheet/session.js";
export * from "./spreadsheet/axis-layout.js";
export * from "./spreadsheet/scroll-projection.js";
export * from "./spreadsheet/viewer-model.js";
export * from "./spreadsheet/viewport-model.js";
