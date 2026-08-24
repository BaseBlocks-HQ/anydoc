import { describe, expect, it, vi } from "vitest";

import { installHostNavigation, routePresentationNavigation } from "../src/presentation/navigation.js";

describe("presentation navigation", () => {
  it("keeps internal slide jumps inside the viewer", () => {
    const goToSlide = vi.fn(async () => undefined);
    const onLink = vi.fn();

    routePresentationNavigation({ slideIndex: 3 }, { goToSlide }, { onLink });

    expect(goToSlide).toHaveBeenCalledWith(3);
    expect(onLink).not.toHaveBeenCalled();
  });

  it("delegates external links to the host without opening them", () => {
    const goToSlide = vi.fn(async () => undefined);
    const onLink = vi.fn();

    routePresentationNavigation({ url: "https://example.com/docs" }, { goToSlide }, { onLink });

    expect(onLink).toHaveBeenCalledWith({ url: "https://example.com/docs" });
    expect(goToSlide).not.toHaveBeenCalled();
  });

  it("blocks external links when the host supplies no handler", () => {
    const goToSlide = vi.fn(async () => undefined);

    expect(() => {
      routePresentationNavigation({ url: "https://example.com" }, { goToSlide }, {});
    }).not.toThrow();
    expect(goToSlide).not.toHaveBeenCalled();
  });

  it("never delegates active URL schemes", () => {
    const viewer = { goToSlide: vi.fn(async () => undefined) };
    const onLink = vi.fn();
    routePresentationNavigation({ url: "javascript:alert(1)" }, viewer, { onLink });
    expect(onLink).not.toHaveBeenCalled();
  });

  it("installs a live host hook on the renderer navigation bridge", () => {
    const viewer = { goToSlide: vi.fn(async () => undefined) };
    const firstHost = vi.fn();
    const secondHost = vi.fn();
    let onLink = firstHost;

    installHostNavigation(viewer as never, () => ({ onLink }));
    const navigate = Reflect.get(viewer, "handleNavigate") as (target: { url: string }) => void;
    navigate({ url: "https://example.com/first" });
    onLink = secondHost;
    navigate({ url: "https://example.com/second" });

    expect(firstHost).toHaveBeenCalledWith({ url: "https://example.com/first" });
    expect(secondHost).toHaveBeenCalledWith({ url: "https://example.com/second" });
  });
});
