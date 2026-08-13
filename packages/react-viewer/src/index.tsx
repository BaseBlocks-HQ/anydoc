import { lazy, Suspense, type ReactElement } from "react";
import type {
  DocumentViewerProps,
  DocxViewerProps,
  MarkdownViewerProps,
  PdfViewerProps,
  TextViewerProps,
} from "./types";

const LazyPdfViewer = lazy(() => import("./viewers/pdf-viewer"));
const LazyDocxViewer = lazy(() => import("./viewers/docx-viewer"));
const LazyTextViewer = lazy(() => import("./viewers/text-viewer"));
const LazyMarkdownViewer = lazy(() => import("./viewers/markdown-viewer"));

function fallback(label: string) {
  return <div aria-live="polite" role="status">Loading {label} viewer…</div>;
}

export function PdfViewer(props: PdfViewerProps): ReactElement {
  return <Suspense fallback={fallback("PDF")}><LazyPdfViewer {...props} /></Suspense>;
}

export function DocxViewer(props: DocxViewerProps): ReactElement {
  return <Suspense fallback={fallback("DOCX")}><LazyDocxViewer {...props} /></Suspense>;
}

export function TextViewer(props: TextViewerProps): ReactElement {
  return <Suspense fallback={fallback("text")}><LazyTextViewer {...props} /></Suspense>;
}

export function MarkdownViewer(props: MarkdownViewerProps): ReactElement {
  return <Suspense fallback={fallback("Markdown")}><LazyMarkdownViewer {...props} /></Suspense>;
}

export function DocumentViewer(props: DocumentViewerProps): ReactElement {
  switch (props.format) {
    case "pdf": return <PdfViewer {...props} />;
    case "docx": return <DocxViewer {...props} />;
    case "text": return <TextViewer {...props} />;
    case "markdown": return <MarkdownViewer {...props} />;
  }
}

export { DefaultViewerControls, useViewerControls } from "./controls";
export type { ViewerControlOptions, ViewerControlSetting } from "@baseblocks/anydoc-viewer-ui";
export { ViewerError, toViewerError } from "./errors";
export { decodeUtf8, loadDocumentBytes } from "./source";
export { sanitizeDocxArchive } from "./docx-archive";
export { AnyDocumentViewer, detectViewerFormat } from "./universal-viewer";
export type { AnyDocumentViewerProps, UniversalViewerControlOptions } from "./universal-viewer";
export type * from "./errors";
export type * from "./types";
