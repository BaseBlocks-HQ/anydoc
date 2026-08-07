import type { CSSProperties, ReactNode } from "react";

export type ViewerFormat = "pdf" | "docx" | "text" | "markdown";

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

export interface ViewerSearchControls {
  readonly current: number;
  readonly next: () => void;
  readonly previous: () => void;
  readonly pending: boolean;
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly total: number;
  readonly truncated?: boolean;
}

export interface ViewerZoomControls {
  readonly max: number;
  readonly min: number;
  readonly reset: () => void;
  readonly set: (zoom: number) => void;
  readonly step: number;
  readonly value: number;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
}

export interface ViewerPaginationControls {
  readonly current: number;
  readonly goTo: (page: number) => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly total: number;
}

export interface ViewerAction {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly pressed?: boolean;
  readonly run: () => void;
}

export interface ViewerControls {
  readonly actions: ReadonlyArray<ViewerAction>;
  readonly format: ViewerFormat;
  readonly pagination?: ViewerPaginationControls;
  readonly search?: ViewerSearchControls;
  readonly status: "loading" | "ready" | "error";
  readonly title?: string;
  readonly zoom?: ViewerZoomControls;
}

export interface BaseViewerProps {
  readonly source: DocumentSource;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly controls?: boolean;
  readonly renderControls?: (controls: ViewerControls) => ReactNode;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  readonly onError?: (error: import("./errors").ViewerError) => void;
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
