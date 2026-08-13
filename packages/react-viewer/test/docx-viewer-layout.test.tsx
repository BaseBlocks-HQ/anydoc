// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/docx-archive", () => ({
  sanitizeDocxArchive: vi.fn(async (bytes: Uint8Array) => bytes),
}));

vi.mock("docx-preview", () => ({
  renderAsync: vi.fn(async (_bytes: Uint8Array, body: HTMLElement) => {
    const page = document.createElement("section");
    page.className = "anydoc-docx";
    page.textContent = "Fixture page";
    body.append(page);
  }),
}));

import DocxViewer from "../src/viewers/docx-viewer";

const resizeCallbacks: ResizeObserverCallback[] = [];

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe("DOCX page layout", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    resizeCallbacks.length = 0;
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("contains the physical page at default zoom and grows only after explicit zoom", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<DocxViewer source={new Uint8Array([1, 2, 3])} />);
    });

    const viewport = container.querySelector<HTMLElement>("[data-anydoc-docx-viewport]");
    const pages = container.querySelector<HTMLElement>("[data-anydoc-docx-pages]");
    const page = container.querySelector<HTMLElement>(".anydoc-docx");
    if (!viewport || !pages || !page) throw new Error("Expected rendered DOCX page elements.");
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(pages, "scrollWidth", { configurable: true, value: 800 });
    Object.defineProperty(pages, "scrollHeight", { configurable: true, value: 1_000 });
    Object.defineProperty(page, "offsetWidth", { configurable: true, value: 800 });

    await act(async () => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    });

    const shell = container.querySelector<HTMLElement>("[data-anydoc-docx-page-shell]");
    if (!shell) throw new Error("Expected DOCX page shell.");
    const containedWidth = Number.parseFloat(shell.style.width);
    expect(containedWidth).toBeGreaterThan(0);
    expect(containedWidth).toBeLessThanOrEqual(400);
    expect(pages.style.transform).toMatch(/^scale\(0\./);

    const zoomIn = container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]');
    await act(async () => zoomIn?.click());
    expect(Number.parseFloat(shell.style.width)).toBeGreaterThan(containedWidth);

    await act(async () => root.unmount());
  });
});
