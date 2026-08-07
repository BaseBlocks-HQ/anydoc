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
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.clearAllMocks();
  });

  it("snapshots scroll position before React releases the event and unmounts safely", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PresentationViewer, { source: new ArrayBuffer(16) }));
    });

    const rail = container.querySelector<HTMLElement>(".presentation-viewer-thumbnails");
    expect(rail).not.toBeNull();
    Object.defineProperty(rail, "scrollTop", { configurable: true, value: 2_240 });
    await act(async () => {
      rail?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(container.querySelector('[aria-label="Go to slide 17"]')).not.toBeNull();

    await act(async () => root.unmount());
    expect(destroy).toHaveBeenCalledOnce();
  });
});
