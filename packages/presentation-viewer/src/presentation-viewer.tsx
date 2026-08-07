import {
  buildPresentation,
  parseZipLazyMedia,
  PptxViewer,
  RECOMMENDED_ZIP_LIMITS,
  type SearchHighlightHandle,
  type SlideHandle,
  type TextSearchResult,
} from "@aiden0z/pptx-renderer";
import {
  DocumentPlatformError,
  assertCountWithinLimit,
  assertWithinByteLimit,
  defaultDocumentLimits,
} from "@baseblocks/anydoc-contracts";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { installHostNavigation, type PresentationLink } from "./navigation.js";
import { blockExternalPresentationMedia } from "./security.js";

type ViewerRuntime = {
  readonly slideKeys: ReadonlyArray<string>;
  readonly viewer: PptxViewer;
};

export type PresentationViewerReadyState = {
  readonly blockedExternalMedia: number;
  readonly slideCount: number;
};

export type PresentationViewerControls = {
  /** Current one-based slide number, or zero until the viewer is ready. */
  readonly currentSlide: number;
  readonly error: DocumentPlatformError | null;
  /** Navigate to a one-based slide number. */
  readonly goToSlide: (slide: number) => void;
  readonly limitations: number;
  readonly nextSearchResult: () => void;
  readonly nextSlide: () => void;
  readonly previousSearchResult: () => void;
  readonly previousSlide: () => void;
  readonly query: string;
  readonly ready: boolean;
  readonly requestFullscreen: () => Promise<void>;
  readonly search: (query: string) => void;
  /** Current one-based result number, or zero when there are no results. */
  readonly searchIndex: number;
  readonly searchResultCount: number;
  readonly slideCount: number;
  /** Zoom multiplier, where 1 is 100%. */
  readonly zoom: number;
  readonly zoomTo: (zoom: number) => void;
};

export type PresentationViewerProps = {
  readonly className?: string;
  /** Called for external hyperlinks. The viewer never opens links itself. */
  readonly onLink?: (link: PresentationLink) => void;
  readonly onError?: (error: DocumentPlatformError) => void;
  readonly onReady?: (state: PresentationViewerReadyState) => void;
  /** Replaces the default toolbar with host-rendered controls. */
  readonly renderControls?: (controls: PresentationViewerControls) => ReactNode;
  /** Defaults to true when renderControls is omitted, otherwise false. */
  readonly showDefaultControls?: boolean;
  readonly source: ArrayBuffer;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly maxSlides?: number;
  readonly style?: CSSProperties;
};

const SOURCE_IDS = new WeakMap<ArrayBuffer, number>();
let nextSourceId = 1;

function sourceId(source: ArrayBuffer): number {
  const existing = SOURCE_IDS.get(source);
  if (existing !== undefined) return existing;
  const id = nextSourceId;
  nextSourceId += 1;
  SOURCE_IDS.set(source, id);
  return id;
}

const buttonStyle = {
  alignItems: "center",
  background: "var(--presentation-viewer-background, #fff)",
  border: "1px solid var(--presentation-viewer-border, #d4d4d8)",
  borderRadius: 6,
  color: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  fontSize: 12,
  height: 30,
  justifyContent: "center",
  padding: "0 10px",
  whiteSpace: "nowrap",
} as const;

const toolbarStyle = {
  alignItems: "center",
  background: "var(--presentation-viewer-background, #fff)",
  borderBottom: "1px solid var(--presentation-viewer-border, #d4d4d8)",
  display: "flex",
  gap: 6,
  minHeight: 44,
  overflowX: "auto",
  padding: "6px 10px",
} as const;

function PresentationThumbnail({
  active,
  index,
  onSelect,
  viewer,
}: {
  readonly active: boolean;
  readonly index: number;
  readonly onSelect: (index: number) => void;
  readonly viewer: PptxViewer;
}) {
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    let handle: SlideHandle | null = null;
    const render = () => {
      handle = viewer.renderThumbnailToContainer(index, element, { width: 132 });
    };

    if (typeof IntersectionObserver === "undefined") {
      render();
      return () => {
        handle?.dispose();
        element.replaceChildren();
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        render();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      handle?.dispose();
      element.replaceChildren();
    };
  }, [index, viewer]);

  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={`Go to slide ${index + 1}`}
      className="presentation-viewer-thumbnail"
      onClick={() => onSelect(index)}
      style={{
        background: active
          ? "color-mix(in srgb, var(--presentation-viewer-accent, #2563eb) 12%, transparent)"
          : "transparent",
        border: active
          ? "2px solid var(--presentation-viewer-accent, #2563eb)"
          : "2px solid transparent",
        borderRadius: 8,
        color: "inherit",
        cursor: "pointer",
        padding: 6,
        width: "100%",
      }}
      type="button"
    >
      <div
        ref={previewRef}
        aria-hidden="true"
        style={{
          aspectRatio: "16 / 9",
          boxShadow: "0 1px 3px rgb(0 0 0 / 18%)",
          margin: "0 auto",
          overflow: "hidden",
          width: 132,
        }}
      />
      <span style={{ display: "block", fontSize: 12, marginTop: 5 }}>Slide {index + 1}</span>
    </button>
  );
}

const THUMBNAIL_HEIGHT = 112;

function PresentationThumbnailRail({
  currentSlide,
  onSelect,
  slideKeys,
  viewer,
}: {
  readonly currentSlide: number;
  readonly onSelect: (index: number) => void;
  readonly slideKeys: ReadonlyArray<string>;
  readonly viewer: PptxViewer;
}) {
  const railRef = useRef<HTMLElement>(null);
  const [viewport, setViewport] = useState({ height: 600, scrollTop: 0 });
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(() => setViewport((value) => ({ ...value, height: rail.clientHeight })));
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const top = currentSlide * THUMBNAIL_HEIGHT;
    if (top < rail.scrollTop) rail.scrollTop = top;
    else if (top + THUMBNAIL_HEIGHT > rail.scrollTop + rail.clientHeight) rail.scrollTop = top + THUMBNAIL_HEIGHT - rail.clientHeight;
  }, [currentSlide]);
  const start = Math.max(0, Math.floor(viewport.scrollTop / THUMBNAIL_HEIGHT) - 4);
  const end = Math.min(slideKeys.length, start + Math.ceil(viewport.height / THUMBNAIL_HEIGHT) + 8);
  return (
    <nav
      aria-label="Presentation slides"
      className="presentation-viewer-thumbnails"
      onScroll={(event) => {
        // React clears currentTarget after the handler returns. Snapshot the DOM
        // value before scheduling an update so a deferred updater never retains
        // the SyntheticEvent or reads from a rail that has since unmounted.
        const scrollTop = event.currentTarget.scrollTop;
        setViewport((value) => ({ ...value, scrollTop }));
      }}
      ref={railRef}
      style={{ borderRight: "1px solid var(--presentation-viewer-border, #d4d4d8)", overflowY: "auto", padding: 8 }}
    >
      <div style={{ height: slideKeys.length * THUMBNAIL_HEIGHT, position: "relative" }}>
        {slideKeys.slice(start, end).map((slideKey, offset) => {
          const index = start + offset;
          return (
            <div key={slideKey} style={{ height: THUMBNAIL_HEIGHT, left: 0, position: "absolute", right: 0, top: index * THUMBNAIL_HEIGHT }}>
              <PresentationThumbnail active={currentSlide === index} index={index} onSelect={onSelect} viewer={viewer} />
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function PresentationToolbar({ controls }: { readonly controls: PresentationViewerControls }) {
  const {
    currentSlide,
    limitations,
    nextSearchResult,
    nextSlide,
    previousSearchResult,
    previousSlide,
    query,
    ready,
    requestFullscreen,
    search,
    searchIndex,
    searchResultCount,
    slideCount,
    zoom,
    zoomTo,
  } = controls;

  return (
    <div style={toolbarStyle}>
      <button disabled={!ready || currentSlide <= 1} onClick={previousSlide} style={buttonStyle} type="button">
        Previous
      </button>
      <span style={{ fontSize: 12, minWidth: 60, textAlign: "center" }}>
        {currentSlide || "–"} / {ready ? slideCount : "–"}
      </span>
      <button
        disabled={!ready || currentSlide >= slideCount}
        onClick={nextSlide}
        style={buttonStyle}
        type="button"
      >
        Next
      </button>
      <button disabled={!ready} onClick={() => zoomTo(zoom - 0.1)} style={buttonStyle} type="button">
        −
      </button>
      <span style={{ fontSize: 12, minWidth: 42, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
      <button disabled={!ready} onClick={() => zoomTo(zoom + 0.1)} style={buttonStyle} type="button">
        +
      </button>
      <input
        aria-label="Search presentation"
        disabled={!ready}
        onChange={(event) => search(event.currentTarget.value)}
        placeholder="Search slides"
        style={{
          border: "1px solid var(--presentation-viewer-border, #d4d4d8)",
          borderRadius: 6,
          height: 30,
          minWidth: 150,
          padding: "0 9px",
        }}
        type="search"
        value={query}
      />
      {searchResultCount > 0 ? (
        <>
          <button onClick={previousSearchResult} style={buttonStyle} type="button">‹</button>
          <span style={{ fontSize: 12 }}>{searchIndex} / {searchResultCount}</span>
          <button onClick={nextSearchResult} style={buttonStyle} type="button">›</button>
        </>
      ) : query ? (
        <span style={{ fontSize: 12 }}>0 matches</span>
      ) : null}
      <button
        disabled={!ready}
        onClick={() => void requestFullscreen()}
        style={{ ...buttonStyle, marginLeft: "auto" }}
        type="button"
      >
        Fullscreen
      </button>
      {limitations > 0 ? (
        <span
          title={`${limitations} blocked or unsupported presentation resources`}
          style={{ fontSize: 12 }}
        >
          {limitations} limitation{limitations === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function PresentationViewerSession({
  className,
  onLink,
  onError,
  onReady,
  renderControls,
  showDefaultControls,
  source,
  signal,
  maxBytes = defaultDocumentLimits.maxBytes,
  maxSlides = defaultDocumentLimits.maxSlides,
  style,
}: PresentationViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const activeHighlightRef = useRef<SearchHighlightHandle | null>(null);
  const hostRef = useRef({ onError, onLink, onReady });
  const searchRequestRef = useRef(0);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [error, setError] = useState<DocumentPlatformError | null>(null);
  const [limitations, setLimitations] = useState(0);
  const [query, setQuery] = useState("");
  const [runtime, setRuntime] = useState<ViewerRuntime | null>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<ReadonlyArray<TextSearchResult>>([]);
  const [zoom, setZoom] = useState(100);

  hostRef.current = { onError, onLink, onReady };

  useEffect(() => {
    const container = slideRef.current;
    if (!container) return;
    let cancelled = false;
    let viewer: PptxViewer | null = null;

    const abort = () => { cancelled = true; };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    void Promise.resolve().then(() => {
      assertWithinByteLimit(source.byteLength, "pptx", { ...defaultDocumentLimits, maxBytes });
      if (cancelled) throw new DOMException("Cancelled", "AbortError");
      return parseZipLazyMedia(source, RECOMMENDED_ZIP_LIMITS);
    })
      .then((files) => {
        if (cancelled) throw new DOMException("Cancelled", "AbortError");
        return buildPresentation(files, { lazySlides: true });
      })
      .then(async (presentation) => {
        if (cancelled) return;
        assertCountWithinLimit(presentation.slides.length, maxSlides, "slide", "pptx");
        const blockedExternalMedia = blockExternalPresentationMedia(presentation);
        viewer = new PptxViewer(container, {
          fitMode: "contain",
          lazyMedia: true,
          lazySlides: true,
          onNodeError: () => setLimitations((count) => count + 1),
          onSlideChange: setCurrentSlide,
          onSlideError: () => setLimitations((count) => count + 1),
          pdfjs: false,
          zipLimits: RECOMMENDED_ZIP_LIMITS,
          zoomPercent: 100,
        });
        installHostNavigation(viewer, () => hostRef.current);
        viewer.load(presentation);
        await viewer.renderSlide(0);
        if (cancelled) {
          viewer.destroy();
          return;
        }
        setLimitations((count) => count + blockedExternalMedia);
        setRuntime({
          slideKeys: presentation.slides.map((slide) => slide.slidePath),
          viewer,
        });
        hostRef.current.onReady?.({ blockedExternalMedia, slideCount: viewer.slideCount });
      })
      .catch((cause: unknown) => {
        if (cancelled || (cause instanceof DOMException && cause.name === "AbortError")) return;
        const nextError = cause instanceof DocumentPlatformError ? cause : new DocumentPlatformError("Unable to open this presentation.", { cause, code: "render-failed", format: "pptx" });
        setError(nextError);
        hostRef.current.onError?.(nextError);
      });

    return () => {
      cancelled = true;
      searchRequestRef.current += 1;
      activeHighlightRef.current?.dispose();
      activeHighlightRef.current = null;
      viewer?.destroy();
      container.replaceChildren();
      signal?.removeEventListener("abort", abort);
    };
  }, [maxBytes, maxSlides, signal, source]);

  const goToSlideIndex = (index: number) => {
    if (!runtime) return;
    const next = Math.max(0, Math.min(runtime.viewer.slideCount - 1, index));
    void runtime.viewer.goToSlide(next);
    setCurrentSlide(next);
  };

  const changeZoom = (nextZoom: number) => {
    if (!runtime || !Number.isFinite(nextZoom)) return;
    const normalized = Math.max(25, Math.min(300, nextZoom));
    setZoom(normalized);
    void runtime.viewer.setZoom(normalized);
  };

  const runSearch = (nextQuery: string) => {
    const searchRequest = searchRequestRef.current + 1;
    searchRequestRef.current = searchRequest;
    setQuery(nextQuery);
    activeHighlightRef.current?.dispose();
    activeHighlightRef.current = null;
    if (!runtime || !nextQuery.trim()) {
      setSearchResults([]);
      setSearchIndex(0);
      return;
    }

    const results = runtime.viewer.searchText(nextQuery.trim());
    setSearchResults(results);
    setSearchIndex(0);
    const first = results[0];
    if (!first) return;

    void runtime.viewer.highlightSearchResult(first).then(
      (highlight) => {
        if (searchRequestRef.current !== searchRequest) {
          highlight?.dispose();
          return;
        }
        activeHighlightRef.current = highlight;
        setCurrentSlide(first.slideIndex);
      },
      () => {
        if (searchRequestRef.current === searchRequest) setLimitations((count) => count + 1);
      },
    );
  };

  const selectSearchResult = (index: number) => {
    if (!runtime || searchResults.length === 0) return;
    const searchRequest = searchRequestRef.current + 1;
    searchRequestRef.current = searchRequest;
    const normalized = (index + searchResults.length) % searchResults.length;
    const result = searchResults[normalized];
    if (!result) return;

    activeHighlightRef.current?.dispose();
    void runtime.viewer.highlightSearchResult(result).then(
      (highlight) => {
        if (searchRequestRef.current !== searchRequest) {
          highlight?.dispose();
          return;
        }
        activeHighlightRef.current = highlight;
        setCurrentSlide(result.slideIndex);
        setSearchIndex(normalized);
      },
      () => {
        if (searchRequestRef.current === searchRequest) setLimitations((count) => count + 1);
      },
    );
  };

  const controls: PresentationViewerControls = {
    currentSlide: runtime ? currentSlide + 1 : 0,
    error,
    goToSlide: (slide) => goToSlideIndex(slide - 1),
    limitations,
    nextSearchResult: () => selectSearchResult(searchIndex + 1),
    nextSlide: () => goToSlideIndex(currentSlide + 1),
    previousSearchResult: () => selectSearchResult(searchIndex - 1),
    previousSlide: () => goToSlideIndex(currentSlide - 1),
    query,
    ready: runtime !== null,
    requestFullscreen: async () => {
      await rootRef.current?.requestFullscreen?.();
    },
    search: runSearch,
    searchIndex: searchResults.length > 0 ? searchIndex + 1 : 0,
    searchResultCount: searchResults.length,
    slideCount: runtime?.viewer.slideCount ?? 0,
    zoom: zoom / 100,
    zoomTo: (value) => changeZoom(value * 100),
  };

  const useDefaultControls = showDefaultControls ?? renderControls === undefined;
  const controlsNode = renderControls?.(controls) ??
    (useDefaultControls ? <PresentationToolbar controls={controls} /> : null);

  return (
    <div
      ref={rootRef}
      className={className}
      data-presentation-viewer=""
      style={{
        color: "var(--presentation-viewer-foreground, #18181b)",
        display: "grid",
        gridTemplateRows: controlsNode ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
        height: "100%",
        minHeight: 0,
        ...style,
      }}
    >
      <style>{`
        [data-presentation-viewer] .presentation-viewer-thumbnail { flex: 0 0 auto; }
        @media (max-width: 640px) {
          [data-presentation-viewer] .presentation-viewer-layout {
            grid-template-columns: 112px minmax(0, 1fr) !important;
          }
          [data-presentation-viewer] .presentation-viewer-thumbnails {
            padding: 4px !important;
          }
          [data-presentation-viewer] .presentation-viewer-thumbnail [aria-hidden="true"] { width: 92px !important; }
          [data-presentation-viewer] .presentation-viewer-canvas { padding: 8px !important; }
        }
      `}</style>
      {controlsNode}
      {error ? (
        <div
          role="alert"
          style={{ color: "#b91c1c", display: "grid", height: "100%", placeItems: "center", padding: 24 }}
        >
          {error.message}
        </div>
      ) : (
        <div
          className="presentation-viewer-layout"
          style={{ display: "grid", gridTemplateColumns: "164px minmax(0, 1fr)", minHeight: 0 }}
        >
          {runtime ? <PresentationThumbnailRail currentSlide={currentSlide} onSelect={goToSlideIndex} slideKeys={runtime.slideKeys} viewer={runtime.viewer} /> : <nav aria-label="Presentation slides" />}
          <div
            className="presentation-viewer-canvas"
            style={{ minHeight: 0, overflow: "auto", padding: 20 }}
          >
            {!runtime ? <div role="status" style={{ textAlign: "center" }}>Opening presentation…</div> : null}
            <div ref={slideRef} style={{ margin: "0 auto", minHeight: 1, width: "100%" }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function PresentationViewer(props: PresentationViewerProps) {
  return <PresentationViewerSession key={sourceId(props.source)} {...props} />;
}
