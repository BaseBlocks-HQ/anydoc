// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const destroy = vi.fn();
const renderThumbnail = vi.fn(() => ({ dispose: vi.fn() }));

vi.mock("@aiden0z/pptx-renderer", () => ({
  RECOMMENDED_ZIP_LIMITS: {},
  buildPresentation: vi.fn(async () => ({
    layouts: new Map(),
    masters: new Map(),
    slides: Array.from({ length: 40 }, (_, index) => ({
      rels: new Map(),
      slidePath: `slide-${index}`,
    })),
  })),
  parseZipLazyMedia: vi.fn(async () => ({})),
  PptxViewer: class {
    slideCount = 40;
    destroy = destroy;
    goToSlide = vi.fn(async () => undefined);
    highlightSearchResult = vi.fn(async () => null);
    load = vi.fn();
    renderSlide = vi.fn(async () => undefined);
    renderThumbnailToContainer = renderThumbnail;
    searchText = vi.fn(() => []);
    setZoom = vi.fn(async () => undefined);
  },
}));

import { PresentationViewer } from "../src/presentation-viewer.js";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe("PresentationViewer lifecycle", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.clearAllMocks();
  });

  it("starts thumbnails at the top, keeps a long deck scrollable, and unmounts safely", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PresentationViewer, { source: new ArrayBuffer(16) }));
    });

    const rail = container.querySelector<HTMLElement>(".presentation-viewer-thumbnails");
    expect(rail).not.toBeNull();
    if (!rail) throw new Error("Expected presentation thumbnail rail.");
    expect(rail?.style.overflowY).toBe("auto");
    expect(rail?.style.alignContent).toBe("flex-start");
    expect(rail?.style.justifyContent).toBe("flex-start");
    expect(rail.scrollTop).toBe(0);
    expect(container.querySelectorAll('[aria-label^="Go to slide "]')).toHaveLength(40);
    const slideFrame = container.querySelector<HTMLElement>(".presentation-viewer-slide-frame");
    expect(slideFrame?.style.display).toBe("grid");
    expect(slideFrame?.style.minHeight).toBe("100%");
    expect(slideFrame?.style.placeItems).toBe("safe center");
    Object.defineProperty(rail, "scrollTop", { configurable: true, value: 0, writable: true });
    Object.defineProperty(rail, "clientHeight", { configurable: true, value: 500 });
    const slide17 = container.querySelector<HTMLButtonElement>('[aria-label="Go to slide 17"]');
    if (!slide17) throw new Error("Expected slide 17 thumbnail.");
    Object.defineProperty(slide17, "offsetTop", { configurable: true, value: 1_600 });
    Object.defineProperty(slide17, "offsetHeight", { configurable: true, value: 100 });
    await act(async () => {
      slide17?.click();
    });
    expect(rail?.scrollTop).toBe(1_200);

    await act(async () => root.unmount());
    expect(destroy).toHaveBeenCalledOnce();
  });
});
