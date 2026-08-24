import type { PptxViewer } from "@aiden0z/pptx-renderer";
import { isSafeExternalUrl } from "@baseblocks/anydoc-contracts";

export type PresentationLink = {
  /** A URL that the renderer classified as safe for hyperlink navigation. */
  readonly url: string;
};

export type PresentationNavigationTarget = {
  readonly slideIndex?: number;
  readonly url?: string;
};

type NavigationHost = {
  readonly onLink?: (link: PresentationLink) => void;
};

export function routePresentationNavigation(
  target: PresentationNavigationTarget,
  viewer: Pick<PptxViewer, "goToSlide">,
  host: NavigationHost,
): void {
  if (Number.isInteger(target.slideIndex) && target.slideIndex !== undefined) {
    void viewer.goToSlide(target.slideIndex);
    return;
  }

  if (typeof target.url === "string" && isSafeExternalUrl(target.url)) {
    host.onLink?.({ url: target.url });
  }
}

/**
 * The renderer owns shape click handling but does not currently expose its
 * navigation hook in ViewerOptions. Replace only that runtime hook so external
 * URLs are delegated to the host instead of being opened by the renderer.
 */
export function installHostNavigation(
  viewer: PptxViewer,
  getHost: () => NavigationHost,
): void {
  Reflect.set(viewer, "handleNavigate", (target: PresentationNavigationTarget) => {
    routePresentationNavigation(target, viewer, getHost());
  });
}
