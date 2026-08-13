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
} from "react";
import {
  ViewerControlRegion,
  ViewerStage,
  viewerRootStyle,
  type ViewerControls,
  type ViewerControlSetting,
} from "@baseblocks/anydoc-viewer-ui";

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

export type PresentationViewerControls = ViewerControls;

export type PresentationViewerProps = {
  readonly className?: string;
  /** Called for external hyperlinks. The viewer never opens links itself. */
  readonly onLink?: (link: PresentationLink) => void;
  readonly onError?: (error: DocumentPlatformError) => void;
  readonly onReady?: (state: PresentationViewerReadyState) => void;
  readonly controls?: ViewerControlSetting;
  readonly onControls?: ((controls: ViewerControls | null) => void) | undefined;
  readonly source: ArrayBuffer;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly maxSlides?: number;
  readonly style?: CSSProperties;
  readonly title?: string;
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

function PresentationThumbnail({
  active,
  index,
  onSelect,
  visible,
  viewer,
}: {
  readonly active: boolean;
  readonly index: number;
  readonly onSelect: (index: number) => void;
  readonly visible: boolean;
  readonly viewer: PptxViewer;
}) {
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = previewRef.current;
    if (!element || !visible) return;
    let handle: SlideHandle | null = null;
    let rendered = false;
    let renderedWidth = 0;
    const render = () => {
      const width = Math.max(1, Math.round(element.clientWidth));
      if (rendered && width === renderedWidth) return;
      handle?.dispose();
      element.replaceChildren();
      handle = viewer.renderThumbnailToContainer(index, element, { width });
      rendered = true;
      renderedWidth = width;
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      if (rendered) render();
    });
    resizeObserver?.observe(element);

    render();
    return () => {
      resizeObserver?.disconnect();
      handle?.dispose();
      element.replaceChildren();
    };
  }, [index, viewer, visible]);

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
        boxSizing: "border-box",
        color: "inherit",
        cursor: "pointer",
        display: "block",
        padding: 6,
        width: "100%",
      }}
      type="button"
    >
      <div
        ref={previewRef}
        aria-hidden="true"
        data-thumbnail-index={index}
        style={{
          aspectRatio: "16 / 9",
          background: "#fff",
          boxShadow: "0 1px 2px rgb(0 0 0 / 10%), 0 4px 12px rgb(0 0 0 / 12%)",
          margin: "0 auto",
          outline: "1px solid oklch(0 0 0 / 0.1)",
          overflow: "hidden",
          width: "100%",
        }}
      />
      <span style={{ display: "block", fontSize: 12, marginTop: 5 }}>Slide {index + 1}</span>
    </button>
  );
}

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
  const [visibleSlides, setVisibleSlides] = useState<ReadonlySet<number>>(
    () => new Set(Array.from({ length: Math.min(8, slideKeys.length) }, (_, index) => index)),
  );

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisibleSlides(new Set(slideKeys.map((_, index) => index)));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      setVisibleSlides((current) => {
        const next = new Set(current);
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.thumbnailIndex);
          if (!Number.isInteger(index)) continue;
          if (entry.isIntersecting || index === currentSlide) next.add(index);
          else next.delete(index);
        }
        if (next.size === current.size && [...next].every((index) => current.has(index))) return current;
        return next;
      });
    }, { root: rail, rootMargin: "400px 0px" });
    for (const preview of rail.querySelectorAll<HTMLElement>("[data-thumbnail-index]")) observer.observe(preview);
    return () => observer.disconnect();
  }, [currentSlide, slideKeys]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    if (currentSlide === 0) {
      rail.scrollTop = 0;
      return;
    }
    const frame = requestAnimationFrame(() => {
      const active = rail.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active || rail.clientHeight <= 0) return;
      if (active.offsetTop < rail.scrollTop) rail.scrollTop = active.offsetTop;
      else if (active.offsetTop + active.offsetHeight > rail.scrollTop + rail.clientHeight) {
        rail.scrollTop = active.offsetTop + active.offsetHeight - rail.clientHeight;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [currentSlide]);

  return (
    <nav
      aria-label="Presentation slides"
      className="presentation-viewer-thumbnails"
      ref={railRef}
      style={{ alignContent: "flex-start", background: "color-mix(in srgb, currentColor 4%, Canvas)", borderInlineEnd: "1px solid color-mix(in srgb, currentColor 12%, transparent)", display: "flex", flexDirection: "column", gap: 6, justifyContent: "flex-start", minHeight: 0, minWidth: 0, overflowY: "auto", padding: 8 }}
    >
      {slideKeys.map((slideKey, index) => (
        <PresentationThumbnail active={currentSlide === index} index={index} key={slideKey} onSelect={onSelect} visible={visibleSlides.has(index)} viewer={viewer} />
      ))}
    </nav>
  );
}

function PresentationViewerSession({
  className,
  controls: controlSetting = true,
  onLink,
  onError,
  onControls,
  onReady,
  source,
  signal,
  maxBytes = defaultDocumentLimits.maxBytes,
  maxSlides = defaultDocumentLimits.maxSlides,
  style,
  title,
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

  const viewerControls: ViewerControls = {
    actions: [{
      disabled: runtime === null,
      icon: "fullscreen",
      id: "fullscreen",
      label: "Fullscreen",
      run: () => void rootRef.current?.requestFullscreen?.(),
    }],
    details: { limitations },
    format: "pptx",
    pagination: {
      current: runtime ? currentSlide + 1 : 0,
      goTo: (slide) => goToSlideIndex(slide - 1),
      next: () => goToSlideIndex(currentSlide + 1),
      previous: () => goToSlideIndex(currentSlide - 1),
      total: runtime?.viewer.slideCount ?? 0,
    },
    search: {
      current: searchResults.length > 0 ? searchIndex + 1 : 0,
      next: () => selectSearchResult(searchIndex + 1),
      pending: false,
      previous: () => selectSearchResult(searchIndex - 1),
      query,
      setQuery: runSearch,
      total: searchResults.length,
    },
    status: error ? "error" : runtime ? "ready" : "loading",
    ...(title === undefined ? {} : { title }),
    zoom: {
      max: 3,
      min: 0.25,
      reset: () => changeZoom(100),
      set: (value) => changeZoom(value * 100),
      step: 0.1,
      value: zoom / 100,
      zoomIn: () => changeZoom(zoom + 10),
      zoomOut: () => changeZoom(zoom - 10),
    },
  };

  return (
    <div
      ref={rootRef}
      className={className}
      data-presentation-viewer=""
      style={{
        ...viewerRootStyle,
        ...style,
      }}
    >
      <style>{`
        [data-presentation-viewer] *, [data-presentation-viewer] *::before, [data-presentation-viewer] *::after { box-sizing: border-box; }
        [data-presentation-viewer] .presentation-viewer-thumbnail { flex: 0 0 auto; }
        @media (max-width: 640px) {
          [data-presentation-viewer] .presentation-viewer-layout {
            grid-template-columns: 112px minmax(0, 1fr) !important;
          }
          [data-presentation-viewer] .presentation-viewer-thumbnails {
            padding: 4px !important;
          }
          [data-presentation-viewer] .presentation-viewer-canvas { padding: 8px !important; }
        }
      `}</style>
      <ViewerControlRegion controls={viewerControls} onControls={onControls} setting={controlSetting} />
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
          style={{ display: "grid", flex: 1, gridTemplateColumns: "clamp(112px, 22%, 176px) minmax(0, 1fr)", minHeight: 0, overflow: "hidden" }}
        >
          {runtime ? <PresentationThumbnailRail currentSlide={currentSlide} onSelect={goToSlideIndex} slideKeys={runtime.slideKeys} viewer={runtime.viewer} /> : <nav aria-label="Presentation slides" />}
          <ViewerStage
            className="presentation-viewer-canvas"
            style={{ padding: 20 }}
          >
            <div
              className="presentation-viewer-slide-frame"
              style={{ display: "grid", minHeight: "100%", minWidth: "100%", placeItems: "safe center" }}
            >
              {!runtime ? <div role="status" style={{ gridArea: "1 / 1", textAlign: "center" }}>Opening presentation…</div> : null}
              <div ref={slideRef} style={{ gridArea: "1 / 1", minHeight: 1, minWidth: 0, width: "100%" }} />
            </div>
          </ViewerStage>
        </div>
      )}
    </div>
  );
}

export function PresentationViewer(props: PresentationViewerProps) {
  return <PresentationViewerSession key={sourceId(props.source)} {...props} />;
}
