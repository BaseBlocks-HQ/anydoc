import type { CSSProperties, ReactElement } from "react";

export interface ViewerIconProps {
  readonly size?: number;
  readonly style?: CSSProperties;
}

function iconPath(path: string): (props: ViewerIconProps) => ReactElement {
  return function Icon({ size = 16, style }: ViewerIconProps) {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height={size}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
        style={style}
        viewBox="0 0 24 24"
        width={size}
      >
        <path d={path} />
      </svg>
    );
  };
}

/** Left arrow used for "previous page". */
export const IconArrow = iconPath("M19 12H5m0 0 6 6m-6-6 6-6");
/** Right arrow used for "next page". */
export const IconArrowRight = iconPath("M5 12h14m0 0-6-6m6 6-6 6");
/** Chevron used for search result stepping. */
export const IconChevron = iconPath("m9 18 6-6-6-6");
/** Two overlapping rectangles for copy. */
export const IconCopy = iconPath(
  "M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm-3 8H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1",
);
/** Single document outline. */
export const IconFile = iconPath("M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6");
/** Multiple documents for continuous page mode. */
export const IconFiles = iconPath("M15 3H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7l-4-4Zm0 0v4h4M5 7v12a2 2 0 0 0 2 2h9");
/** Fullscreen corner brackets. */
export const IconFullscreen = iconPath("M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5");
/** Minus for zoom out. */
export const IconMinus = iconPath("M5 12h14");
/** Crescent moon for dark appearance. */
export const IconMoon = iconPath("M20 13.5A8.5 8.5 0 0 1 10.5 4a7.5 7.5 0 1 0 9.5 9.5Z");
/** Plus for zoom in. */
export const IconPlus = iconPath("M12 5v14m-7-7h14");
/** Circular refresh arrows for rotate/reset. */
export const IconRefresh = iconPath("M20 11a8 8 0 1 0 .5 4M20 4v7h-7");
/** Magnifying glass for document search. */
export const IconSearch = iconPath("M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm9.5 3-4.9-4.9");
/** Sun for light appearance. */
export const IconSun = iconPath("M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-12V2m0 20v-2m10-8h-2M4 12H2m15.5-5.5L19 5M5 19l1.5-1.5m11 3L19 19M5 5l1.5 1.5");
