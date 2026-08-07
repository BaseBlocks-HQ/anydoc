import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { assertCountWithinLimit, defaultDocumentLimits } from "@baseblocks/anydoc-contracts";
import { ViewerControlRegion, viewerRootStyle, viewerScrollerStyle } from "../controls";
import { ViewerError, toViewerError } from "../errors";
import { loadDocumentBytes } from "../source";
import type { PdfViewerProps, ViewerControls } from "../types";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const DEFAULT_PAGE_RATIO = 1.414;

function PdfCanvasPage({
  activeMatch,
  document,
  height,
  onError,
  onRatio,
  pageNumber,
  rotation,
  width,
}: {
  readonly activeMatch: boolean;
  readonly document: PDFDocumentProxy;
  readonly height: number;
  readonly onError: (error: ViewerError) => void;
  readonly onRatio?: (ratio: number) => void;
  readonly pageNumber: number;
  readonly rotation: number;
  readonly width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<ViewerError | null>(null);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: { cancel(): void; render(): Promise<unknown> } | undefined;
    setError(null);
    setRendering(true);
    void document.getPage(pageNumber).then(async (page) => {
      if (cancelled) return;
      const unscaled = page.getViewport({ rotation, scale: 1 });
      onRatio?.(unscaled.height / unscaled.width);
      const scale = Math.min(width / unscaled.width, height / unscaled.height);
      const viewport = page.getViewport({ rotation, scale });
      const outputScale = Math.min(globalThis.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas 2D rendering is unavailable.");
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      renderTask = page.render({
        canvas,
        canvasContext: context,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        viewport,
      });
      await renderTask.promise;
      if (cancelled) return;
      const { TextLayer } = await import("pdfjs-dist");
      const textContainer = textLayerRef.current;
      if (textContainer) {
        textContainer.replaceChildren();
        textLayer = new TextLayer({
          container: textContainer,
          textContentSource: page.streamTextContent(),
          viewport,
        });
        await textLayer.render();
      }
      if (!cancelled) setRendering(false);
      page.cleanup();
    }).catch((cause: unknown) => {
      if (cancelled || (cause instanceof Error && cause.name === "RenderingCancelledException")) return;
      const nextError = toViewerError(cause, { code: "render-failed", format: "pdf", message: `Unable to render PDF page ${pageNumber}.` });
      setError(nextError);
      setRendering(false);
      onError(nextError);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [document, height, onError, onRatio, pageNumber, rotation, width]);

  return (
    <div
      aria-busy={rendering}
      aria-label={`PDF page ${pageNumber}`}
      role="group"
      style={{
        alignItems: "center",
        background: "#fff",
        boxShadow: activeMatch ? "0 0 0 3px Highlight" : "0 1px 5px rgb(0 0 0 / 20%)",
        display: "flex",
        height,
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        width,
      }}
    >
      {error ? (
        <div role="alert" style={{ color: "#991b1b", maxWidth: "28rem", padding: "1rem", textAlign: "center" }}>
          {error.message}
        </div>
      ) : (
        <>
          <canvas aria-hidden="true" ref={canvasRef} style={{ display: "block" }} />
          <div
            className="anydoc-pdf-text-layer"
            ref={textLayerRef}
            role="document"
            style={{ height: "100%", inset: 0, lineHeight: 1, overflow: "hidden", position: "absolute", transformOrigin: "0 0", width: "100%" }}
          />
        </>
      )}
    </div>
  );
}

export default function PdfViewer({
  className,
  controls: showControls = true,
  maxBytes,
  maxPages = defaultDocumentLimits.maxPdfPages,
  maxRenderedPages = 7,
  maxSearchPages = 250,
  onError,
  renderControls,
  signal,
  source,
  style,
  title,
  workerSrc,
}: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [containerSize, setContainerSize] = useState({ height: 800, width: 900 });
  const [currentPage, setCurrentPage] = useState(1);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<ViewerError | null>(null);
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchingPages, setMatchingPages] = useState<number[]>([]);
  const [mode, setMode] = useState<"continuous" | "single">("continuous");
  const [pageRatio, setPageRatio] = useState(DEFAULT_PAGE_RATIO);
  const [query, setQuery] = useState("");
  const [rotation, setRotation] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [searchPending, setSearchPending] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [zoom, setZoom] = useState(1);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerSize({ height: entry.contentRect.height, width: entry.contentRect.width });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    let loadingTask: { destroy: () => Promise<void> } | undefined;
    setDocument(null);
    setError(null);
    void (async () => {
      const bytes = await loadDocumentBytes(source, {
        format: "pdf",
        ...(maxBytes === undefined ? {} : { maxBytes }),
        signal: controller.signal,
      });
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc ?? new URL("./pdf.worker.min.mjs", import.meta.url).toString();
      const task = pdfjs.getDocument({
        data: bytes,
        disableAutoFetch: true,
        disableStream: true,
        enableXfa: false,
      });
      loadingTask = task;
      const nextDocument = await task.promise;
      try {
        assertCountWithinLimit(nextDocument.numPages, maxPages, "PDF page", "pdf");
      } catch (cause) {
        await task.destroy();
        throw cause;
      }
      if (controller.signal.aborted) {
        await task.destroy();
        throw new DOMException("Cancelled", "AbortError");
      }
      setDocument(nextDocument);
      setCurrentPage(1);
    })().catch((cause: unknown) => {
      const nextError = toViewerError(cause, {
        code: "worker-failed",
        format: "pdf",
        message: "Unable to open this PDF document.",
      });
      if (nextError.code === "aborted") return;
      setError(nextError);
      onErrorRef.current?.(nextError);
    });
    return () => {
      controller.abort();
      signal?.removeEventListener("abort", abort);
      if (loadingTask) void loadingTask.destroy();
    };
  }, [maxBytes, maxPages, signal, source, workerSrc]);

  useEffect(() => {
    if (!document) return;
    const needle = deferredQuery.trim().toLocaleLowerCase();
    setMatchIndex(0);
    if (!needle) {
      setMatchingPages([]);
      setSearchPending(false);
      setSearchTruncated(false);
      return;
    }
    let cancelled = false;
    const requestedLimit = Number.isFinite(maxSearchPages) ? Math.floor(maxSearchPages) : 250;
    const pageLimit = Math.min(document.numPages, Math.max(1, Math.min(2_000, requestedLimit)));
    const matches: number[] = [];
    let nextPage = 1;
    setSearchPending(true);
    setSearchTruncated(document.numPages > pageLimit);
    const search = async () => {
      for (;;) {
        const pageNumber = nextPage++;
        if (cancelled || pageNumber > pageLimit) return;
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").toLocaleLowerCase();
        if (text.includes(needle)) matches.push(pageNumber);
        page.cleanup();
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, pageLimit) }, search)).then(() => {
      if (cancelled) return;
      setMatchingPages(matches.sort((left, right) => left - right));
      setSearchPending(false);
    }).catch((cause: unknown) => {
      if (cancelled) return;
      const searchError = toViewerError(cause, { code: "search-failed", format: "pdf", message: "PDF search could not be completed." });
      setMatchingPages([]);
      setSearchPending(false);
      onErrorRef.current?.(searchError);
    });
    return () => { cancelled = true; };
  }, [deferredQuery, document, maxSearchPages]);

  const pageCount = document?.numPages ?? 0;
  const pageWidth = Math.max(240, Math.min(1200, containerSize.width - 32) * zoom);
  const pageHeight = pageWidth * pageRatio;
  const pageSlot = pageHeight + 20;
  const requestedRenderedPages = Number.isFinite(maxRenderedPages) ? Math.floor(maxRenderedPages) : 12;
  const boundedRenderedPages = Math.max(1, Math.min(32, requestedRenderedPages));
  const visiblePages = useMemo(() => {
    if (pageCount === 0) return [];
    if (mode === "single") return [currentPage];
    const desired = Math.ceil(containerSize.height / pageSlot) + 4;
    const count = Math.min(pageCount, boundedRenderedPages, Math.max(1, desired));
    const start = Math.max(0, Math.min(pageCount - count, Math.floor(scrollTop / pageSlot) - 2));
    return Array.from({ length: count }, (_, index) => start + index + 1);
  }, [boundedRenderedPages, containerSize.height, currentPage, mode, pageCount, pageSlot, scrollTop]);

  const goToPage = (page: number) => {
    const next = Math.max(1, Math.min(pageCount || 1, Math.round(page)));
    setCurrentPage(next);
    if (mode === "continuous" && scrollRef.current) scrollRef.current.scrollTop = (next - 1) * pageSlot;
  };
  const moveMatch = (delta: number) => {
    if (matchingPages.length === 0) return;
    const next = (matchIndex + delta + matchingPages.length) % matchingPages.length;
    setMatchIndex(next);
    const page = matchingPages[next];
    if (page !== undefined) goToPage(page);
  };
  const setBoundedZoom = (value: number) => setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)));
  const stablePageError = useCallback((nextError: ViewerError) => {
    onErrorRef.current?.(nextError);
  }, []);
  const viewerControls: ViewerControls = {
    actions: [
      { id: "rotate", label: "Rotate clockwise", run: () => setRotation((value) => (value + 90) % 360) },
      { id: "layout", label: mode === "continuous" ? "Single page" : "Continuous", pressed: mode === "single", run: () => setMode((value) => value === "continuous" ? "single" : "continuous") },
    ],
    format: "pdf",
    pagination: { current: currentPage, goTo: goToPage, next: () => goToPage(currentPage + 1), previous: () => goToPage(currentPage - 1), total: pageCount },
    search: { current: matchingPages.length > 0 ? matchIndex + 1 : 0, next: () => moveMatch(1), pending: searchPending, previous: () => moveMatch(-1), query, setQuery, total: matchingPages.length, truncated: searchTruncated },
    status: error ? "error" : document ? "ready" : "loading",
    ...(title === undefined ? {} : { title }),
    zoom: { max: MAX_ZOOM, min: MIN_ZOOM, reset: () => setZoom(1), set: setBoundedZoom, step: ZOOM_STEP, value: zoom, zoomIn: () => setBoundedZoom(zoom + ZOOM_STEP), zoomOut: () => setBoundedZoom(zoom - ZOOM_STEP) },
  };

  return (
    <section aria-label={title ? `PDF viewer: ${title}` : "PDF viewer"} className={className} style={{ ...viewerRootStyle, ...style }}>
      <style>{`.anydoc-pdf-text-layer span,.anydoc-pdf-text-layer br{color:transparent;cursor:text;position:absolute;white-space:pre;transform-origin:0 0}.anydoc-pdf-text-layer ::selection{background:Highlight;color:transparent}`}</style>
      {showControls ? <ViewerControlRegion controls={viewerControls}>{renderControls}</ViewerControlRegion> : null}
      {error ? <div role="alert" style={{ margin: "auto", padding: "1rem" }}>{error.message}</div> : null}
      {!error ? (
        <div
          onScroll={(event) => {
            const nextScrollTop = event.currentTarget.scrollTop;
            setScrollTop(nextScrollTop);
            if (mode === "continuous" && pageCount > 0) setCurrentPage(Math.min(pageCount, Math.floor((nextScrollTop + containerSize.height * 0.3) / pageSlot) + 1));
          }}
          ref={scrollRef}
          style={{ ...viewerScrollerStyle, background: "#e5e7eb", padding: "1rem" }}
          tabIndex={0}
        >
          {!document ? <div aria-live="polite" role="status" style={{ color: "#111827", textAlign: "center" }}>Opening PDF…</div> : null}
          {document ? (
            <div style={mode === "continuous" ? { height: pageCount * pageSlot, margin: "0 auto", position: "relative", width: pageWidth } : { display: "flex", justifyContent: "center" }}>
              {visiblePages.map((pageNumber) => (
                <div key={pageNumber} style={mode === "continuous" ? { left: 0, position: "absolute", top: (pageNumber - 1) * pageSlot } : undefined}>
                  <PdfCanvasPage
                    activeMatch={matchingPages[matchIndex] === pageNumber}
                    document={document}
                    height={pageHeight}
                    onError={stablePageError}
                    {...(pageNumber === 1 ? { onRatio: setPageRatio } : {})}
                    pageNumber={pageNumber}
                    rotation={rotation}
                    width={pageWidth}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
