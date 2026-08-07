import { useEffect, useRef, useState } from "react";
import { ViewerControlRegion, viewerRootStyle, viewerScrollerStyle } from "../controls";
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
  renderControls,
  signal,
  source,
  style,
  title,
}: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const matchesRef = useRef<HTMLElement[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [error, setError] = useState<ViewerError | null>(null);
  const [matchCount, setMatchCount] = useState(0);
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
        inWrapper: true,
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
      {showControls ? <ViewerControlRegion controls={viewerControls}>{renderControls}</ViewerControlRegion> : null}
      {error ? <div role="alert" style={{ margin: "auto", padding: "1rem" }}>{error.message}</div> : null}
      {!error ? (
        <div style={{ ...viewerScrollerStyle, padding: "1.5rem" }} tabIndex={0}>
          {!ready ? <div aria-live="polite" role="status" style={{ textAlign: "center" }}>Opening DOCX…</div> : null}
          <div
            ref={containerRef}
            style={{
              margin: "0 auto",
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
              width: `${100 / zoom}%`,
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
