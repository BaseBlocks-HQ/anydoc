import type { ViewerFormat } from "@baseblocks/anydoc/react";
import { isSafeExternalUrl } from "@baseblocks/anydoc/security";
import { lazy, StrictMode, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./styles.css";

type SupportedFormat = ViewerFormat | "csv" | "pptx" | "xlsx";

const DocumentViewer = lazy(() =>
  import("@baseblocks/anydoc/react").then((module) => ({ default: module.DocumentViewer })),
);
const PresentationViewer = lazy(() =>
  import("@baseblocks/anydoc/presentation").then((module) => ({ default: module.PresentationViewer })),
);
const SpreadsheetViewer = lazy(() =>
  import("@baseblocks/anydoc/spreadsheet").then((module) => ({ default: module.SpreadsheetViewer })),
);

function extensionOf(name: string): SupportedFormat | null {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "md" || extension === "markdown") return "markdown";
  if (
    extension === "txt" ||
    extension === "pdf" ||
    extension === "docx" ||
    extension === "csv" ||
    extension === "xlsx" ||
    extension === "pptx"
  ) {
    return extension === "txt" ? "text" : extension;
  }
  return null;
}

function ViewerExample() {
  const [file, setFile] = useState<File>();
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [format, setFormat] = useState<SupportedFormat>();
  const [error, setError] = useState<string>();

  async function selectFile(selected: File | undefined) {
    setError(undefined);
    setFile(undefined);
    setBytes(undefined);
    setFormat(undefined);
    if (!selected) return;
    const nextFormat = extensionOf(selected.name);
    if (!nextFormat) {
      setError("Choose a PDF, DOCX, XLSX, CSV, PPTX, Markdown, or text file.");
      return;
    }
    setFile(selected);
    setFormat(nextFormat);
    if (nextFormat === "xlsx" || nextFormat === "csv" || nextFormat === "pptx") {
      setBytes(await selected.arrayBuffer());
    }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">AnyDoc platform</p>
        <h1>Native document viewer</h1>
        <p>Files stay in this browser. Pick a representative document to exercise the format-native viewer.</p>
        <label className="picker">
          <span>Document</span>
          <input
            accept=".csv,.docx,.md,.markdown,.pdf,.pptx,.txt,.xlsx"
            onChange={(event) => void selectFile(event.currentTarget.files?.[0])}
            type="file"
          />
        </label>
        {file ? <p aria-live="polite">Viewing {file.name}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </header>
      <section aria-label="Document preview" className="preview">
        <Suspense fallback={<p aria-live="polite" className="empty">Loading viewer…</p>}>
          {!file || !format ? <p className="empty">Choose a document to begin.</p> : null}
          {file && (format === "pdf" || format === "docx" || format === "text" || format === "markdown") ? (
            <DocumentViewer format={format} source={file} />
          ) : null}
          {bytes && (format === "xlsx" || format === "csv") ? (
            <SpreadsheetViewer format={format} source={bytes} />
          ) : null}
          {bytes && format === "pptx" ? (
            <PresentationViewer
              onLink={(link) => {
                if (isSafeExternalUrl(link.url)) window.open(link.url, "_blank", "noopener,noreferrer");
              }}
              source={bytes}
            />
          ) : null}
        </Suspense>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The AnyDoc example root is missing.");
const runtime = globalThis as typeof globalThis & { __anydocExampleRoot?: Root };
const root = runtime.__anydocExampleRoot ?? createRoot(rootElement);
runtime.__anydocExampleRoot = root;
root.render(
  <StrictMode>
    <ViewerExample />
  </StrictMode>,
);
