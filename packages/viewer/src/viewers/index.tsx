import { lazy, Suspense, type ReactElement } from "react";
import type {
  DocumentViewerProps,
  DocxViewerProps,
  MarkdownViewerProps,
  PdfViewerProps,
  TextViewerProps,
} from "../types.js";

const LazyPdfViewer = lazy(() => import("./pdf-viewer.js"));
const LazyDocxViewer = lazy(() => import("./docx-viewer.js"));
const LazyTextViewer = lazy(() => import("./text-viewer.js"));
const LazyMarkdownViewer = lazy(() => import("./markdown-viewer.js"));

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
