// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ViewerToolbar, type ViewerControls } from "../src/react.js";

const controls: ViewerControls = {
  actions: [{ icon: "fullscreen", id: "fullscreen", label: "Fullscreen", run: vi.fn() }],
  format: "pdf",
  pagination: { current: 2, goTo: vi.fn(), next: vi.fn(), previous: vi.fn(), total: 5 },
  search: { current: 1, next: vi.fn(), pending: false, previous: vi.fn(), query: "term", setQuery: vi.fn(), total: 3 },
  status: "ready",
  title: "Report.pdf",
  zoom: { max: 4, min: 0.25, reset: vi.fn(), set: vi.fn(), step: 0.1, value: 1, zoomIn: vi.fn(), zoomOut: vi.fn() },
};

describe("ViewerToolbar", () => {
  it("renders one labelled toolbar with consistent controls", () => {
    const markup = renderToStaticMarkup(<ViewerToolbar controls={controls} />);

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('aria-label="PDF viewer controls"');
    expect(markup).toContain('aria-label="Zoom out"');
    expect(markup).toContain("Search document");
    expect(markup).toContain('aria-label="Fullscreen"');
    expect(markup).toContain("Report.pdf");
  });

  it("keeps search collapsed until requested and restores focus on Escape", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(container);
    const collapsedControls: ViewerControls = {
      ...controls,
      search: { ...controls.search!, query: "" },
    };

    await act(async () => root.render(<ViewerToolbar controls={collapsedControls} />));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Search document"]');
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('input[type="search"]')).toBeNull();

    await act(async () => trigger?.click());
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(container.querySelector("[data-anydoc-search-count]")).toBeNull();
    expect(container.querySelector('[aria-label="Previous search result"]')).toBeNull();
    expect(container.querySelector('[aria-label="Next search result"]')).toBeNull();

    await act(async () => root.render(
      <ViewerToolbar
        controls={{
          ...collapsedControls,
          search: { ...collapsedControls.search!, current: 1, query: "term", total: 3 },
        }}
      />,
    ));
    expect(container.querySelector("[data-anydoc-search-count]")?.textContent).toBe("1/3");
    expect(container.querySelector('[aria-label="Previous search result"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Next search result"]')).not.toBeNull();

    await act(async () => input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await act(async () => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
});
