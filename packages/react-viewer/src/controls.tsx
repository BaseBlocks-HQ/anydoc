import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ViewerControls } from "./types";

const ViewerControlsContext = createContext<ViewerControls | null>(null);

export function useViewerControls(): ViewerControls {
  const value = useContext(ViewerControlsContext);
  if (value === null) {
    throw new Error("useViewerControls must be used within a document viewer control renderer.");
  }
  return value;
}

const toolbarStyle: CSSProperties = {
  alignItems: "center",
  borderBottom: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.375rem",
  minHeight: "2.75rem",
  padding: "0.375rem 0.625rem",
};

const buttonStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
  borderRadius: "0.375rem",
  color: "inherit",
  cursor: "pointer",
  minHeight: "2rem",
  padding: "0.25rem 0.5rem",
};

export function DefaultViewerControls({ controls }: { readonly controls: ViewerControls }) {
  const { pagination, search, zoom } = controls;
  return (
    <div aria-label={`${controls.format} viewer controls`} role="toolbar" style={toolbarStyle}>
      {controls.title ? (
        <span style={{ fontWeight: 600, marginInlineEnd: "auto", overflow: "hidden", textOverflow: "ellipsis" }}>
          {controls.title}
        </span>
      ) : null}
      {pagination ? (
        <div aria-label="Page navigation" role="group" style={{ alignItems: "center", display: "flex", gap: "0.25rem" }}>
          <button aria-label="Previous page" disabled={pagination.current <= 1} onClick={pagination.previous} style={buttonStyle} type="button">←</button>
          <span aria-live="polite" style={{ minWidth: "4.5rem", textAlign: "center" }}>
            {pagination.current} / {pagination.total || "–"}
          </span>
          <button aria-label="Next page" disabled={pagination.current >= pagination.total} onClick={pagination.next} style={buttonStyle} type="button">→</button>
        </div>
      ) : null}
      {zoom ? (
        <div aria-label="Zoom controls" role="group" style={{ alignItems: "center", display: "flex", gap: "0.25rem" }}>
          <button aria-label="Zoom out" disabled={zoom.value <= zoom.min} onClick={zoom.zoomOut} style={buttonStyle} type="button">−</button>
          <button aria-label="Reset zoom" onClick={zoom.reset} style={buttonStyle} type="button">
            {Math.round(zoom.value * 100)}%
          </button>
          <button aria-label="Zoom in" disabled={zoom.value >= zoom.max} onClick={zoom.zoomIn} style={buttonStyle} type="button">+</button>
        </div>
      ) : null}
      {controls.actions.map((action) => (
        <button
          aria-pressed={action.pressed}
          disabled={action.disabled}
          key={action.id}
          onClick={action.run}
          style={buttonStyle}
          type="button"
        >
          {action.label}
        </button>
      ))}
      {search ? (
        <div role="search" style={{ alignItems: "center", display: "flex", gap: "0.25rem" }}>
          <label>
            <span style={{ clip: "rect(0 0 0 0)", clipPath: "inset(50%)", height: 1, overflow: "hidden", position: "absolute", whiteSpace: "nowrap", width: 1 }}>
              Search document
            </span>
            <input
              onChange={(event) => search.setQuery(event.currentTarget.value)}
              placeholder="Search"
              style={{ background: "transparent", border: "1px solid color-mix(in srgb, currentColor 25%, transparent)", borderRadius: "0.375rem", color: "inherit", minHeight: "2rem", padding: "0.25rem 0.5rem", width: "9rem" }}
              type="search"
              value={search.query}
            />
          </label>
          <button aria-label="Previous search result" disabled={search.total === 0} onClick={search.previous} style={buttonStyle} type="button">↑</button>
          <button aria-label="Next search result" disabled={search.total === 0} onClick={search.next} style={buttonStyle} type="button">↓</button>
          <span aria-live="polite" role="status" style={{ minWidth: "4.5rem" }}>
            {search.pending ? "Searching…" : search.query ? `${search.current || 0} / ${search.total}${search.truncated ? "+" : ""}` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function ViewerControlRegion({
  children,
  controls,
}: {
  readonly children: ((controls: ViewerControls) => ReactNode) | undefined;
  readonly controls: ViewerControls;
}) {
  return (
    <ViewerControlsContext.Provider value={controls}>
      {children ? children(controls) : <DefaultViewerControls controls={controls} />}
    </ViewerControlsContext.Provider>
  );
}

export const viewerRootStyle: CSSProperties = {
  background: "Canvas",
  color: "CanvasText",
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
};

export const viewerScrollerStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  overscrollBehavior: "contain",
};
