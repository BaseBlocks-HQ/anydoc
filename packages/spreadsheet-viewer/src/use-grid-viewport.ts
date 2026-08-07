import { startTransition, useEffect, useState, type RefObject } from "react";

export type SpreadsheetGridViewport = Readonly<{
  height: number;
  scrollLeft: number;
  scrollTop: number;
  width: number;
}>;

const EMPTY_VIEWPORT: SpreadsheetGridViewport = {
  height: 0,
  scrollLeft: 0,
  scrollTop: 0,
  width: 0,
};

export function useSpreadsheetGridViewport(
  scrollRef: RefObject<HTMLDivElement | null>,
  horizontalScrollStep = 1,
  verticalScrollStep = 1,
): SpreadsheetGridViewport {
  const [viewport, setViewport] = useState(EMPTY_VIEWPORT);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let frame: number | null = null;
    const update = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const next = {
          height: element.clientHeight,
          scrollLeft: Math.floor(element.scrollLeft / horizontalScrollStep) * horizontalScrollStep,
          scrollTop: Math.floor(element.scrollTop / verticalScrollStep) * verticalScrollStep,
          width: element.clientWidth,
        };
        startTransition(() => {
          setViewport((previous) =>
            previous.height === next.height &&
            previous.scrollLeft === next.scrollLeft &&
            previous.scrollTop === next.scrollTop &&
            previous.width === next.width
              ? previous
              : next,
          );
        });
      });
    };
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      element.removeEventListener("scroll", update);
      resizeObserver.disconnect();
    };
  }, [horizontalScrollStep, scrollRef, verticalScrollStep]);

  return viewport;
}
