import type { CSSProperties } from "react";
import type {
  ViewerControls,
  ViewerControlSetting,
  ViewerFormat,
} from "./controls.js";

export type {
  ViewerAction,
  ViewerControls,
  ViewerControlOptions,
  ViewerControlSetting,
  ViewerFormat,
} from "./controls.js";
export type DocumentViewerFormat = Extract<ViewerFormat, "pdf" | "docx" | "text" | "markdown">;

export interface UrlDocumentSource {
  readonly url: string | URL;
  readonly headers?: HeadersInit;
  readonly credentials?: RequestCredentials;
}

export interface BytesDocumentSource {
  readonly data: ArrayBuffer | ArrayBufferView | Blob;
}

export type DocumentSource =
  | string
  | URL
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | UrlDocumentSource
  | BytesDocumentSource;

export interface BaseViewerProps {
  readonly source: DocumentSource;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly controls?: ViewerControlSetting;
  readonly onControls?: ((controls: ViewerControls | null) => void) | undefined;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  readonly onError?: (error: import("./errors.js").ViewerError) => void;
}

export interface PdfViewerProps extends BaseViewerProps {
  readonly workerSrc?: string;
  readonly maxPages?: number;
  readonly maxRenderedPages?: number;
  readonly maxSearchPages?: number;
}

export interface DocxViewerProps extends BaseViewerProps {
  readonly allowExternalResource?: (url: string, kind: string) => boolean;
}

export interface TextViewerProps extends BaseViewerProps {
  readonly encoding?: "utf-8";
}

export interface MarkdownViewerProps extends BaseViewerProps {
  readonly allowRemoteImages?: boolean;
}

export type DocumentViewerProps =
  | ({ readonly format: "pdf" } & PdfViewerProps)
  | ({ readonly format: "docx" } & DocxViewerProps)
  | ({ readonly format: "text" } & TextViewerProps)
  | ({ readonly format: "markdown" } & MarkdownViewerProps);
