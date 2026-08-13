import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ViewerControlRegion, ViewerStage, viewerRootStyle } from "../controls";
import { ViewerError, toViewerError } from "../errors";
import { sanitizeDocxArchive } from "../docx-archive";
import { clearSearchHighlights, highlightText, sanitizeDocxDom } from "../security";
import { loadDocumentBytes } from "../source";
import type { DocxViewerProps, ViewerControls } from "../types";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

export default function DocxViewer({
  allowExternalResource,
  className,
  controls: showControls = true,
  maxBytes,
  onError,
  onControls,
  signal,
  source,
  style,
  title,
}: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const matchesRef = useRef<HTMLElement[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [error, setError] = useState<ViewerError | null>(null);
  const [matchCount, setMatchCount] = useState(0);
  const [pageMetrics, setPageMetrics] = useState({ availableWidth: 0, height: 0, width: 0 });
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [resultIndex, setResultIndex] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const liveContainer = containerRef.current;
    if (!liveContainer) return;
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    liveContainer.replaceChildren();
    setPageMetrics({ availableWidth: 0, height: 0, width: 0 });
    setError(null);
    setReady(false);

    void (async () => {
      const bytes = await loadDocumentBytes(source, {
        format: "docx",
        ...(maxBytes === undefined ? {} : { maxBytes }),
        signal: controller.signal,
      });
      const { renderAsync } = await import("docx-preview");
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const stagingBody = document.createElement("div");
      const stagingStyles = document.createElement("div");
      const sanitizedArchive = await sanitizeDocxArchive(bytes);
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      await renderAsync(sanitizedArchive, stagingBody, stagingStyles, {
        breakPages: true,
        className: "anydoc-docx",
        experimental: true,
        ignoreFonts: false,
        inWrapper: false,
        renderEndnotes: true,
        renderFooters: true,
        renderFootnotes: true,
        renderHeaders: true,
        useBase64URL: true,
      });
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      sanitizeDocxDom(stagingStyles, allowExternalResource);
      sanitizeDocxDom(stagingBody, allowExternalResource);
      liveContainer.replaceChildren(...stagingStyles.childNodes, ...stagingBody.childNodes);
      setReady(true);
    })().catch((cause: unknown) => {
      const nextError = toViewerError(cause, {
        code: "render-failed",
        format: "docx",
        message: "Unable to render this DOCX document.",
      });
      if (nextError.code === "aborted") return;
      setError(nextError);
      onErrorRef.current?.(nextError);
    });

    return () => {
      controller.abort();
      signal?.removeEventListener("abort", abort);
      liveContainer.replaceChildren();
    };
  }, [allowExternalResource, maxBytes, signal, source]);

  useLayoutEffect(() => {
    const pages = containerRef.current;
    const viewport = viewportRef.current;
    if (!pages || !viewport || !ready) return;
    const measure = () => {
      const viewportStyle = getComputedStyle(viewport);
      const availableWidth = Math.max(
        1,
        viewport.clientWidth
          - Number.parseFloat(viewportStyle.paddingInlineStart || "0")
          - Number.parseFloat(viewportStyle.paddingInlineEnd || "0"),
      );
      const pageWidth = Array.from(pages.querySelectorAll<HTMLElement>(".anydoc-docx"))
        .reduce((width, page) => Math.max(width, page.offsetWidth), 0);
      const width = Math.max(pageWidth, pages.scrollWidth);
      const height = pages.scrollHeight;
      setPageMetrics((current) => (
        current.availableWidth === availableWidth && current.height === height && current.width === width
          ? current
          : { availableWidth, height, width }
      ));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(pages);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !ready) return;
    const matches = highlightText(root, query);
    matchesRef.current = matches;
    setMatchCount(matches.length);
    setResultIndex(0);
    return () => {
      clearSearchHighlights(root);
      matchesRef.current = [];
    };
  }, [query, ready]);

  const moveResult = (delta: number) => {
    if (matchesRef.current.length === 0) return;
    const next = (resultIndex + delta + matchesRef.current.length) % matchesRef.current.length;
    setResultIndex(next);
    matchesRef.current[next]?.scrollIntoView({ block: "center" });
  };
  const setBoundedZoom = (value: number) => setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)));
  const fitScale = pageMetrics.width > 0 ? Math.min(1, pageMetrics.availableWidth / pageMetrics.width) : 1;
  const renderedScale = fitScale * zoom;
  const viewerControls: ViewerControls = {
    actions: [],
    format: "docx",
    search: { current: matchCount > 0 ? resultIndex + 1 : 0, next: () => moveResult(1), pending: false, previous: () => moveResult(-1), query, setQuery, total: matchCount },
    status: error ? "error" : ready ? "ready" : "loading",
    ...(title === undefined ? {} : { title }),
    zoom: {
      max: MAX_ZOOM,
      min: MIN_ZOOM,
      reset: () => setZoom(1),
      set: setBoundedZoom,
      step: ZOOM_STEP,
      value: zoom,
      zoomIn: () => setBoundedZoom(zoom + ZOOM_STEP),
      zoomOut: () => setBoundedZoom(zoom - ZOOM_STEP),
    },
  };

  return (
    <section aria-label={title ? `DOCX viewer: ${title}` : "DOCX viewer"} className={className} style={{ ...viewerRootStyle, ...style }}>
      <ViewerControlRegion controls={viewerControls} onControls={onControls} setting={showControls} />
      {error ? <div role="alert" style={{ margin: "auto", padding: "1rem" }}>{error.message}</div> : null}
      {!error ? (
        <ViewerStage
          data-anydoc-docx-viewport=""
          ref={viewportRef}
          style={{ padding: "1.5rem" }}
        >
          <style>{`
            [data-anydoc-docx-viewport] .anydoc-docx {
              background: white;
              box-shadow: 0 1px 2px rgb(0 0 0 / 10%), 0 8px 28px rgb(0 0 0 / 12%);
              color: #171717;
              margin: 0 auto 24px;
              outline: 1px solid oklch(0 0 0 / 0.1);
            }
            [data-anydoc-docx-pages] { inline-size: 100%; }
          `}</style>
          {!ready ? <div aria-live="polite" role="status" style={{ textAlign: "center" }}>Opening DOCX…</div> : null}
          <div
            data-anydoc-docx-page-shell=""
            style={pageMetrics.width > 0 ? {
              height: pageMetrics.height * renderedScale,
              marginInline: "auto",
              width: pageMetrics.width * renderedScale,
            } : undefined}
          >
            <div
              data-anydoc-docx-pages=""
              ref={containerRef}
              style={pageMetrics.width > 0 ? {
                inlineSize: pageMetrics.width,
                transform: `scale(${renderedScale})`,
                transformOrigin: "top left",
              } : undefined}
            />
          </div>
        </ViewerStage>
      ) : null}
    </section>
  );
}
