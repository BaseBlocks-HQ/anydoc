import { DocumentPlatformError, type DocumentErrorCode } from "@baseblocks/anydoc-contracts";
import type { ViewerFormat } from "./types.js";

export type ViewerErrorCode = DocumentErrorCode;

export interface ViewerErrorDetails {
  readonly code: ViewerErrorCode;
  readonly format?: ViewerFormat;
  readonly cause?: unknown;
  readonly status?: number;
}

export class ViewerError extends DocumentPlatformError {
  constructor(message: string, details: ViewerErrorDetails) {
    super(message, details);
    this.name = "ViewerError";
    Object.assign(this, details);
  }
}

export function toViewerError(
  cause: unknown,
  fallback: Omit<ViewerErrorDetails, "cause"> & { readonly message: string },
): ViewerError {
  if (cause instanceof ViewerError) return cause;
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return new ViewerError("Document loading was cancelled.", {
      code: "aborted",
      cause,
      ...(fallback.format === undefined ? {} : { format: fallback.format }),
    });
  }
  return new ViewerError(fallback.message, {
    code: fallback.code,
    cause,
    ...(fallback.format === undefined ? {} : { format: fallback.format }),
    ...(fallback.status === undefined ? {} : { status: fallback.status }),
  });
}
