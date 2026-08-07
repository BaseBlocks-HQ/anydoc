import "@testing-library/jest-dom/vitest";

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback([{
      borderBoxSize: [{ blockSize: 600, inlineSize: 900 }],
      contentBoxSize: [{ blockSize: 600, inlineSize: 900 }],
      contentRect: { bottom: 600, height: 600, left: 0, right: 900, top: 0, width: 900, x: 0, y: 0, toJSON: () => ({}) },
      devicePixelContentBoxSize: [],
      target,
    }], this);
  }
  disconnect() {}
  unobserve() {}
}

globalThis.ResizeObserver = TestResizeObserver;
HTMLElement.prototype.scrollIntoView = () => undefined;
