import {
  useEffect,
  useCallback,
  memo,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ViewerControlOptions, ViewerControlSetting } from "./controls.js";
import { ViewerError, toViewerError } from "./errors.js";
import { loadDocumentBytes } from "./source.js";
import type { DocumentSource, ViewerControls, ViewerFormat } from "./types.js";
import type { DocumentViewerProps, DocxViewerProps, MarkdownViewerProps, PdfViewerProps, TextViewerProps } from "./types.js";
import type { PresentationViewerProps } from "./presentation/index.js";
import type { SpreadsheetViewerProps } from "./spreadsheet/index.js";
import { detectViewerFormat, detectViewerFormatFromBytes } from "./detect.js";

type ViewerModule =
  | { readonly default: ComponentType<DocumentViewerProps> }
  | { readonly PresentationViewer: ComponentType<PresentationViewerProps> }
  | { readonly SpreadsheetViewer: ComponentType<SpreadsheetViewerProps> };

const VIEWER_LOADERS: Record<ViewerFormat, () => Promise<ViewerModule>> = {
  csv: () => import("./spreadsheet/index.js"),
  docx: () => import("./viewers/docx-viewer.js"),
  markdown: () => import("./viewers/markdown-viewer.js"),
  pdf: () => import("./viewers/pdf-viewer.js"),
  pptx: () => import("./presentation/index.js"),
  text: () => import("./viewers/text-viewer.js"),
  xlsx: () => import("./spreadsheet/index.js"),
};

export type UniversalViewerControlOptions = ViewerControlOptions;

export interface AnyDocumentViewerProps {
  readonly source: DocumentSource;
  readonly format?: ViewerFormat;
  readonly filename?: string;
  readonly contentType?: string;
  readonly title?: string;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  /** true/default: built-in controls; false: headless; object: transform, replace, or relocate. */
  readonly controls?: ViewerControlSetting;
  /** Receives the current universal control model, including in headless mode. */
  readonly onControls?: ((controls: ViewerControls | null) => void) | undefined;
  readonly onError?: (error: ViewerError) => void;
  readonly loading?: ReactNode | ((format: ViewerFormat) => ReactNode);
  readonly error?: ReactNode | ((error: ViewerError) => ReactNode);
  readonly viewerOptions?: {
    readonly pdf?: Omit<PdfViewerProps, "source">;
    readonly docx?: Omit<DocxViewerProps, "source">;
    readonly markdown?: Omit<MarkdownViewerProps, "source">;
    readonly text?: Omit<TextViewerProps, "source">;
    readonly presentation?: Omit<PresentationViewerProps, "source">;
    readonly spreadsheet?: Omit<SpreadsheetViewerProps, "format" | "source">;
  };
}

const ViewerImplementation = memo(function ViewerImplementation({
  bytes,
  controls,
  format,
  module,
  onControls,
  onError,
  options,
  signal,
  title,
}: {
  readonly bytes: Uint8Array;
  readonly controls: ViewerControlSetting;
  readonly format: ViewerFormat;
  readonly module: ViewerModule;
  readonly onControls?: ((controls: ViewerControls | null) => void) | undefined;
  readonly onError: (error: unknown) => void;
  readonly options: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly title?: string;
}) {
  const buffer = useMemo(() => (
    bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  ), [bytes]);
  if (format === "pptx") {
    const Component = (module as Extract<ViewerModule, { readonly PresentationViewer: unknown }>).PresentationViewer;
    return <Component {...options} controls={controls} onControls={onControls} onError={onError} {...(signal === undefined ? {} : { signal })} source={buffer} {...(title === undefined ? {} : { title })} />;
  }
  if (format === "xlsx" || format === "csv") {
    const Component = (module as Extract<ViewerModule, { readonly SpreadsheetViewer: unknown }>).SpreadsheetViewer;
    return <Component {...options} controls={controls} format={format} onControls={onControls} onError={onError} {...(signal === undefined ? {} : { signal })} source={buffer} {...(title === undefined ? {} : { title })} />;
  }
  const Component = (module as Extract<ViewerModule, { readonly default: unknown }>).default;
  const documentProps = {
    ...options,
    controls,
    format,
    onControls,
    onError,
    ...(signal === undefined ? {} : { signal }),
    source: buffer,
    ...(title === undefined ? {} : { title }),
  } as DocumentViewerProps;
  return <Component {...documentProps} />;
});

const EMPTY_VIEWER_OPTIONS = Object.freeze({});

export function AnyDocumentViewer(props: AnyDocumentViewerProps): ReactElement {
  const formatHint = detectViewerFormat(props);
  const [state, setState] = useState<{
    readonly bytes?: Uint8Array;
    readonly error?: ViewerError;
    readonly format?: ViewerFormat;
    readonly module?: ViewerModule;
    readonly source?: DocumentSource;
  }>({});
  const onErrorRef = useRef(props.onError);
  const onControlsRef = useRef(props.onControls);
  onErrorRef.current = props.onError;
  onControlsRef.current = props.onControls;

  useEffect(() => {
    const controller = new AbortController();
    const signal = props.signal ? AbortSignal.any([props.signal, controller.signal]) : controller.signal;
    setState({});
    onControlsRef.current?.(null);
    void loadDocumentBytes(props.source, { ...(formatHint === undefined ? {} : { format: formatHint }), ...(props.maxBytes === undefined ? {} : { maxBytes: props.maxBytes }), signal })
      .then(async (bytes) => {
        const detected = await detectViewerFormatFromBytes(bytes);
        const format = detected ?? formatHint;
        if (!format) throw new ViewerError("The viewer format could not be detected. Pass format or filename for signature-less input.", { code: "invalid-source" });
        const module = await VIEWER_LOADERS[format]();
        if (!signal.aborted) setState({ bytes, format, module, source: props.source });
      })
      .catch((cause: unknown) => {
        if (signal.aborted) return;
        const error = toViewerError(cause, { code: "render-failed", ...(formatHint ? { format: formatHint } : {}), message: "Unable to open this document. Ensure the optional viewer package for this format is installed." });
        setState({ error });
        onErrorRef.current?.(error);
      });
    return () => controller.abort();
  }, [formatHint, props.maxBytes, props.signal, props.source]);

  useEffect(() => () => onControlsRef.current?.(null), []);
  const handleViewerError = useCallback((cause: unknown) => {
    if (!state.format) return;
    const error = toViewerError(cause, { code: "render-failed", format: state.format, message: "Unable to render this document." });
    onErrorRef.current?.(error);
  }, [state.format]);
  const stateIsCurrent = state.source === props.source;
  let body: ReactNode;
  if (state.error) body = typeof props.error === "function" ? props.error(state.error) : props.error ?? <div role="alert">{state.error.message}</div>;
  else if (!stateIsCurrent || !state.bytes || !state.module || !state.format) body = typeof props.loading === "function"
    ? (formatHint ? props.loading(formatHint) : <div aria-live="polite" role="status">Opening document…</div>)
    : props.loading ?? <div aria-live="polite" role="status">Opening document…</div>;
  else {
    const options = state.format === "pptx" ? props.viewerOptions?.presentation
      : state.format === "xlsx" || state.format === "csv" ? props.viewerOptions?.spreadsheet
      : props.viewerOptions?.[state.format];
    body = <ViewerImplementation bytes={state.bytes} controls={props.controls ?? true} format={state.format} module={state.module} onControls={props.onControls} onError={handleViewerError} options={options ?? EMPTY_VIEWER_OPTIONS} {...(props.signal === undefined ? {} : { signal: props.signal })} {...(props.title === undefined ? {} : { title: props.title })} />;
  }

  return (
    <div className={props.className} data-any-document-viewer={state.format ?? formatHint ?? "unknown"} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, ...props.style }}>
      <div style={{ flex: 1, minHeight: 0 }}>{body}</div>
    </div>
  );
}
