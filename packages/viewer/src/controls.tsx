import {
  IconArrow,
  IconArrowRight,
  IconChevron,
  IconCopy,
  IconFile,
  IconFiles,
  IconFullscreen,
  IconMinus,
  IconMoon,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSun,
  type ViewerIconProps as IconProps,
} from "./icons.js";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ViewerFormat = "csv" | "docx" | "markdown" | "pdf" | "pptx" | "text" | "xlsx";

export type ViewerActionIcon =
  | "continuous"
  | "copy"
  | "dark"
  | "fullscreen"
  | "light"
  | "rotate"
  | "single";

export type ViewerAction = Readonly<{
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  icon?: ViewerActionIcon;
  pressed?: boolean;
}>;

export type ViewerControls = Readonly<{
  actions: readonly ViewerAction[];
  details?: Readonly<Record<string, unknown>>;
  format: ViewerFormat;
  pagination?: Readonly<{
    current: number;
    goTo: (page: number) => void;
    next: () => void;
    previous: () => void;
    total: number;
  }>;
  search?: Readonly<{
    current: number;
    next: () => void;
    pending: boolean;
    previous: () => void;
    query: string;
    setQuery: (query: string) => void;
    total: number;
    truncated?: boolean;
  }>;
  status: "error" | "loading" | "ready";
  title?: string;
  zoom?: Readonly<{
    max: number;
    min: number;
    reset: () => void;
    set: (zoom: number) => void;
    step: number;
    value: number;
    zoomIn: () => void;
    zoomOut: () => void;
  }>;
}>;

export interface ViewerControlOptions {
  readonly render?: (controls: ViewerControls, defaultControls: ReactNode) => ReactNode;
  readonly target?: Element | null;
  readonly transform?: (controls: ViewerControls) => ViewerControls;
}

export type ViewerControlSetting = boolean | ViewerControlOptions;

const ViewerControlsContext = createContext<ViewerControls | null>(null);

export function useViewerControls(): ViewerControls {
  const value = useContext(ViewerControlsContext);
  if (value === null) throw new Error("useViewerControls must be used within a viewer control renderer.");
  return value;
}

const ACTION_ICONS: Record<ViewerActionIcon, ComponentType<IconProps>> = {
  continuous: IconFiles,
  copy: IconCopy,
  dark: IconMoon,
  fullscreen: IconFullscreen,
  light: IconSun,
  rotate: IconRefresh,
  single: IconFile,
};

const controlStyles = `
  [data-anydoc-toolbar] {
    --anydoc-control-fg: currentColor;
    --anydoc-control-muted: color-mix(in srgb, currentColor 58%, transparent);
    --anydoc-control-border: color-mix(in srgb, currentColor 13%, transparent);
    --anydoc-control-surface: color-mix(in srgb, currentColor 5%, transparent);
    --anydoc-control-hover: color-mix(in srgb, currentColor 9%, transparent);
    --anydoc-control-active: color-mix(in srgb, currentColor 14%, transparent);
    align-items: center;
    background: Canvas;
    border-block-end: 1px solid var(--anydoc-control-border);
    box-sizing: border-box;
    color: CanvasText;
    display: flex;
    flex: 0 0 auto;
    gap: 12px;
    min-block-size: 44px;
    overflow-x: auto;
    padding: 6px 8px;
    scrollbar-width: thin;
  }
  [data-anydoc-toolbar] *, [data-anydoc-toolbar] *::before, [data-anydoc-toolbar] *::after { box-sizing: border-box; }
  [data-anydoc-control-group] {
    align-items: center;
    background: var(--anydoc-control-surface);
    border-radius: 8px;
    display: inline-flex;
    flex: 0 0 auto;
    gap: 2px;
    min-block-size: 32px;
    padding: 2px;
  }
  [data-anydoc-control-button] {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--anydoc-control-muted);
    cursor: pointer;
    display: inline-flex;
    font: 500 12px/1 ui-sans-serif, system-ui, sans-serif;
    block-size: 28px;
    justify-content: center;
    min-inline-size: 28px;
    padding: 0 7px;
    position: relative;
    transition-property: background-color, color, scale;
    transition-duration: 120ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }
  [data-anydoc-control-button]:hover:not(:disabled) { background: var(--anydoc-control-hover); color: var(--anydoc-control-fg); }
  [data-anydoc-control-button]:active:not(:disabled) { scale: 0.96; }
  [data-anydoc-control-button][aria-pressed="true"] { background: var(--anydoc-control-active); color: var(--anydoc-control-fg); }
  [data-anydoc-control-button]:disabled { cursor: default; opacity: 0.32; }
  [data-anydoc-control-button]:focus-visible,
  [data-anydoc-search-input]:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 1px;
  }
  [data-anydoc-control-value] {
    color: var(--anydoc-control-fg);
    font: 500 12px/1 ui-sans-serif, system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    min-inline-size: 48px;
    padding-inline: 4px;
    text-align: center;
    white-space: nowrap;
  }
  [data-anydoc-search] {
    align-items: center;
    background: var(--anydoc-control-surface);
    border-radius: 8px;
    display: flex;
    flex: 0 0 auto;
    min-block-size: 32px;
    padding: 2px;
  }
  [data-anydoc-search-field] { align-items: center; color: var(--anydoc-control-muted); display: flex; }
  [data-anydoc-search-input] {
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--anydoc-control-fg);
    font: 400 13px/1 ui-sans-serif, system-ui, sans-serif;
    block-size: 28px;
    inline-size: 136px;
    min-inline-size: 0;
    padding: 0 7px;
  }
  [data-anydoc-search-input]::placeholder { color: var(--anydoc-control-muted); }
  [data-anydoc-search-count] {
    color: var(--anydoc-control-muted);
    font: 500 11px/1 ui-sans-serif, system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    min-inline-size: 40px;
    padding-inline: 4px;
    text-align: center;
    white-space: nowrap;
  }
  [data-anydoc-toolbar-title] {
    color: var(--anydoc-control-fg);
    flex: 1 1 10rem;
    font: 600 13px/1.2 ui-sans-serif, system-ui, sans-serif;
    min-inline-size: 6rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 32rem) {
    [data-anydoc-toolbar] { gap: 8px; }
    [data-anydoc-toolbar-title] { display: none; }
    [data-anydoc-search-input] { inline-size: 104px; }
  }
  @media (forced-colors: active) {
    [data-anydoc-control-group], [data-anydoc-search] { border: 1px solid ButtonBorder; }
    [data-anydoc-control-button][aria-pressed="true"] { outline: 1px solid Highlight; }
  }
`;

type IconButtonProps = Readonly<{
  children: ReactNode;
  label: string;
}> & ButtonHTMLAttributes<HTMLButtonElement>;

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  children,
  label,
  ...props
}, ref) {
  return (
    <button aria-label={label} data-anydoc-control-button="" ref={ref} title={label} type="button" {...props}>
      <span aria-hidden="true" style={{ alignItems: "center", display: "inline-flex" }}>{children}</span>
    </button>
  );
});

function ActionButton({ action }: Readonly<{ action: ViewerAction }>) {
  const Icon = action.icon ? ACTION_ICONS[action.icon] : undefined;
  return (
    <IconButton
      aria-pressed={action.pressed}
      disabled={action.disabled}
      label={action.label}
      onClick={action.run}
    >
      {Icon ? <Icon size={16} /> : <span aria-hidden="true">{action.label}</span>}
    </IconButton>
  );
}

function SearchControl({ search }: Readonly<{ search: NonNullable<ViewerControls["search"]> }>) {
  const [expanded, setExpanded] = useState(() => search.query.length > 0);
  const hasQuery = search.query.trim().length > 0;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const close = () => {
    setExpanded(false);
    triggerRef.current?.focus();
  };

  return (
    <div data-anydoc-search="" data-state={expanded ? "open" : "closed"} role="search">
      <IconButton
        aria-controls={expanded ? inputId : undefined}
        aria-expanded={expanded}
        label={expanded ? "Close search" : "Search document"}
        onClick={() => expanded ? close() : setExpanded(true)}
        ref={triggerRef}
      >
        <IconSearch size={16} />
      </IconButton>
      {expanded ? (
        <>
          <label data-anydoc-search-field="" htmlFor={inputId}>
            <span style={{ clip: "rect(0 0 0 0)", clipPath: "inset(50%)", height: 1, overflow: "hidden", position: "absolute", whiteSpace: "nowrap", width: 1 }}>Search document</span>
            <input
              data-anydoc-search-input=""
              id={inputId}
              onChange={(event) => search.setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") close();
              }}
              placeholder="Search"
              ref={inputRef}
              type="search"
              value={search.query}
            />
          </label>
          {hasQuery ? (
            <>
              <span aria-live="polite" data-anydoc-search-count="" role="status">
                {search.pending ? "…" : `${search.current || 0}/${search.total}${search.truncated ? "+" : ""}`}
              </span>
              <IconButton disabled={search.total === 0} label="Previous search result" onClick={search.previous}><IconChevron size={14} style={{ rotate: "180deg" }} /></IconButton>
              <IconButton disabled={search.total === 0} label="Next search result" onClick={search.next}><IconChevron size={14} /></IconButton>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function ViewerToolbar({ controls }: Readonly<{ controls: ViewerControls }>) {
  const { pagination, search, zoom } = controls;
  return (
    <>
      <style>{controlStyles}</style>
      <div aria-label={`${controls.format.toUpperCase()} viewer controls`} data-anydoc-toolbar="" role="toolbar">
        {controls.title ? <span data-anydoc-toolbar-title="" title={controls.title}>{controls.title}</span> : null}
        {pagination ? (
          <div aria-label="Page navigation" data-anydoc-control-group="" role="group">
            <IconButton disabled={pagination.current <= 1} label="Previous page" onClick={pagination.previous}><IconArrow size={16} /></IconButton>
            <span aria-live="polite" data-anydoc-control-value="">{pagination.current || "–"} / {pagination.total || "–"}</span>
            <IconButton disabled={pagination.current >= pagination.total} label="Next page" onClick={pagination.next}><IconArrowRight size={16} /></IconButton>
          </div>
        ) : null}
        {zoom ? (
          <div aria-label="Zoom" data-anydoc-control-group="" role="group">
            <IconButton disabled={zoom.value <= zoom.min} label="Zoom out" onClick={zoom.zoomOut}><IconMinus size={16} /></IconButton>
            <button aria-label="Reset zoom" data-anydoc-control-button="" onClick={zoom.reset} title="Reset zoom" type="button">{Math.round(zoom.value * 100)}%</button>
            <IconButton disabled={zoom.value >= zoom.max} label="Zoom in" onClick={zoom.zoomIn}><IconPlus size={16} /></IconButton>
          </div>
        ) : null}
        {search ? <SearchControl search={search} /> : null}
        {controls.actions.length > 0 ? (
          <div aria-label="Document actions" data-anydoc-control-group="" role="group">
            {controls.actions.map((action) => <ActionButton action={action} key={action.id} />)}
          </div>
        ) : null}
      </div>
    </>
  );
}

export function ViewerControlRegion({
  controls,
  onControls,
  setting = true,
}: Readonly<{
  controls: ViewerControls;
  onControls?: ((controls: ViewerControls | null) => void) | undefined;
  setting?: ViewerControlSetting;
}>) {
  const options = typeof setting === "object" ? setting : undefined;
  const current = options?.transform ? options.transform(controls) : controls;
  useEffect(() => () => onControls?.(null), [onControls]);
  useEffect(() => onControls?.(current), [current, onControls]);
  if (setting === false) return null;
  const defaults = <ViewerToolbar controls={current} />;
  let node = options?.render ? options.render(current, defaults) : defaults;
  if (node && options?.target) node = createPortal(node, options.target);
  return <ViewerControlsContext.Provider value={current}>{node}</ViewerControlsContext.Provider>;
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

export const viewerStageStyle: CSSProperties = {
  ...viewerScrollerStyle,
  background: "color-mix(in srgb, CanvasText 7%, Canvas)",
  padding: "1rem",
};

export const ViewerStage = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ViewerStage({
  children,
  style,
  tabIndex = 0,
  ...props
}, ref) {
  return (
    <div data-anydoc-viewer-stage="" ref={ref} style={{ ...viewerStageStyle, ...style }} tabIndex={tabIndex} {...props}>
      {children}
    </div>
  );
});
