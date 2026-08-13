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
import type { ViewerControlOptions, ViewerControlSetting } from "@baseblocks/anydoc-viewer-ui";
import { ViewerError, toViewerError } from "./errors";
import { loadDocumentBytes } from "./source";
import type { DocumentSource, ViewerControls, ViewerFormat } from "./types";
import type { DocumentViewerProps, DocxViewerProps, MarkdownViewerProps, PdfViewerProps, TextViewerProps } from "./types";
import type { PresentationViewerProps } from "@baseblocks/anydoc-presentation-viewer";
import type { SpreadsheetViewerProps } from "@baseblocks/anydoc-spreadsheet-viewer";

type ViewerModule =
  | { readonly default: ComponentType<DocumentViewerProps> }
  | { readonly PresentationViewer: ComponentType<PresentationViewerProps> }
  | { readonly SpreadsheetViewer: ComponentType<SpreadsheetViewerProps> };

const VIEWER_LOADERS: Record<ViewerFormat, () => Promise<ViewerModule>> = {
  csv: () => import("@baseblocks/anydoc-spreadsheet-viewer"),
  docx: () => import("./viewers/docx-viewer"),
  markdown: () => import("./viewers/markdown-viewer"),
  pdf: () => import("./viewers/pdf-viewer"),
  pptx: () => import("@baseblocks/anydoc-presentation-viewer"),
  text: () => import("./viewers/text-viewer"),
  xlsx: () => import("@baseblocks/anydoc-spreadsheet-viewer"),
};

const EXTENSIONS: Record<string, ViewerFormat> = {
  csv: "csv",
  docx: "docx",
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  pdf: "pdf",
  pptx: "pptx",
  text: "text",
  txt: "text",
  xlsx: "xlsx",
};

const CONTENT_TYPES: Record<string, ViewerFormat> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/csv": "csv",
  "text/markdown": "markdown",
  "text/plain": "text",
  "text/x-markdown": "markdown",
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

function sourceFilename(source: DocumentSource): string | undefined {
  if (typeof File !== "undefined" && source instanceof File) return source.name;
  const value = typeof source === "object" && source !== null && "url" in source ? source.url : source;
  if (typeof value !== "string" && !(value instanceof URL)) return undefined;
  try {
    const path = value instanceof URL ? value.pathname : new URL(value, globalThis.location?.href).pathname;
    return decodeURIComponent(path.split("/").at(-1) ?? "");
  } catch {
    return typeof value === "string" ? value.split(/[\\/]/).at(-1) : undefined;
  }
}

function sourceContentType(source: DocumentSource): string | undefined {
  return typeof Blob !== "undefined" && source instanceof Blob && source.type ? source.type : undefined;
}

export function detectViewerFormat(input: {
  readonly source: DocumentSource;
  readonly format?: ViewerFormat;
  readonly filename?: string;
  readonly contentType?: string;
}): ViewerFormat | undefined {
  if (input.format) return input.format;
  const contentType = (input.contentType ?? sourceContentType(input.source))?.split(";", 1)[0]?.toLowerCase();
  if (contentType && CONTENT_TYPES[contentType]) return CONTENT_TYPES[contentType];
  const filename = input.filename ?? sourceFilename(input.source);
  const extension = filename?.split(".").at(-1)?.toLowerCase();
  if (extension && EXTENSIONS[extension]) return EXTENSIONS[extension];
  return undefined;
}

function littleEndian32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] ?? 0) | (bytes[offset + 1] ?? 0) << 8 | (bytes[offset + 2] ?? 0) << 16 | (bytes[offset + 3] ?? 0) << 24) >>> 0;
}

/** Inspect authoritative PDF/OOXML signatures without parsing in render. */
export async function detectViewerFormatFromBytes(bytes: Uint8Array): Promise<ViewerFormat | undefined> {
  if (bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "pdf";
  if (bytes.byteLength < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return undefined;
  const floor = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (littleEndian32(bytes, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) return undefined;
  const size = littleEndian32(bytes, eocd + 12);
  const start = littleEndian32(bytes, eocd + 16);
  if (start > bytes.byteLength || size > bytes.byteLength - start) return undefined;
  const ceiling = Math.min(start + size, start + 2 * 1024 * 1024);
  const decoder = new TextDecoder();
  let offset = start;
  for (let entries = 0; offset + 46 <= ceiling && entries < 20_000; entries += 1) {
    if (littleEndian32(bytes, offset) !== 0x02014b50) break;
    const nameLength = (bytes[offset + 28] ?? 0) | (bytes[offset + 29] ?? 0) << 8;
    const extraLength = (bytes[offset + 30] ?? 0) | (bytes[offset + 31] ?? 0) << 8;
    const commentLength = (bytes[offset + 32] ?? 0) | (bytes[offset + 33] ?? 0) << 8;
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > ceiling) break;
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.startsWith("word/")) return "docx";
    if (name.startsWith("ppt/")) return "pptx";
    if (name.startsWith("xl/")) return "xlsx";
    offset = end;
    if (entries > 0 && entries % 500 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return undefined;
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
