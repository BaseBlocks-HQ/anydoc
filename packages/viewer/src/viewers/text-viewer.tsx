import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ViewerControlRegion, viewerRootStyle, viewerScrollerStyle } from "../controls.js";
import { useAbortableValue } from "../hooks.js";
import { decodeUtf8, loadDocumentBytes } from "../source.js";
import type { TextViewerProps, ViewerControls } from "../types.js";

export default function TextViewer({
  className,
  controls: showControls = true,
  maxBytes,
  onError,
  onControls,
  signal,
  source,
  style,
  title,
}: TextViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [resultIndex, setResultIndex] = useState(0);
  const [wrap, setWrap] = useState(true);
  const state = useAbortableValue(
    async (abortSignal) => decodeUtf8(await loadDocumentBytes(source, { format: "text", ...(maxBytes === undefined ? {} : { maxBytes }), signal: abortSignal }), "text"),
    [source, maxBytes, signal],
    { code: "fetch-failed", format: "text", message: "Unable to open the text document." },
    signal,
    onError,
  );
  const text = state.status === "ready" ? state.value : "";
  const lines = useMemo(() => text.split(/\r?\n/u), [text]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];
    const indexes: number[] = [];
    lines.forEach((line, index) => {
      if (line.toLocaleLowerCase().includes(normalizedQuery)) indexes.push(index);
    });
    return indexes;
  }, [lines, normalizedQuery]);
  const virtualizer = useVirtualizer({
    count: state.status === "ready" ? lines.length : 0,
    estimateSize: () => (wrap ? 24 : 20),
    getScrollElement: () => scrollRef.current,
    ...(wrap ? { measureElement: (element: Element) => element.getBoundingClientRect().height } : {}),
    overscan: 20,
  });

  useEffect(() => setResultIndex(0), [normalizedQuery]);
  useEffect(() => {
    const line = matches[resultIndex];
    if (line !== undefined) virtualizer.scrollToIndex(line, { align: "center" });
  }, [matches, resultIndex, virtualizer]);

  const moveResult = (delta: number) => {
    if (matches.length === 0) return;
    setResultIndex((current) => (current + delta + matches.length) % matches.length);
  };
  const viewerControls: ViewerControls = {
    actions: [{ id: "wrap", label: "Wrap lines", pressed: wrap, run: () => setWrap((value) => !value) }],
    format: "text",
    search: {
      current: matches.length > 0 ? resultIndex + 1 : 0,
      next: () => moveResult(1),
      pending: false,
      previous: () => moveResult(-1),
      query,
      setQuery,
      total: matches.length,
    },
    status: state.status,
    ...(title === undefined ? {} : { title }),
  };

  return (
    <section aria-label={title ? `Text viewer: ${title}` : "Text viewer"} className={className} style={{ ...viewerRootStyle, ...style }}>
      <ViewerControlRegion controls={viewerControls} onControls={onControls} setting={showControls} />
      {state.status === "error" ? <div role="alert" style={{ margin: "auto", padding: "1rem" }}>{state.error.message}</div> : null}
      {state.status === "loading" ? <div aria-live="polite" role="status" style={{ margin: "auto", padding: "1rem" }}>Opening text…</div> : null}
      {state.status === "ready" ? (
        <div ref={scrollRef} style={{ ...viewerScrollerStyle, fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "0.8125rem" }} tabIndex={0}>
          <div style={{ height: virtualizer.getTotalSize(), minWidth: "100%", position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualLine) => {
              const line = lines[virtualLine.index] ?? "";
              const matched = normalizedQuery && line.toLocaleLowerCase().includes(normalizedQuery);
              return (
                <div
                  data-index={virtualLine.index}
                  key={virtualLine.key}
                  ref={virtualizer.measureElement}
                  style={{
                    background: matched ? "color-mix(in srgb, Mark 45%, transparent)" : undefined,
                    display: "flex",
                    left: 0,
                    lineHeight: wrap ? "1.5rem" : "1.25rem",
                    minHeight: wrap ? "1.5rem" : "1.25rem",
                    minWidth: "100%",
                    position: "absolute",
                    top: 0,
                    transform: `translateY(${virtualLine.start}px)`,
                  }}
                >
                  <span aria-hidden="true" style={{ color: "GrayText", flex: "0 0 3.5rem", paddingInlineEnd: "0.75rem", textAlign: "end", userSelect: "none" }}>{virtualLine.index + 1}</span>
                  <span style={{ overflowWrap: wrap ? "anywhere" : undefined, paddingInlineEnd: "1rem", whiteSpace: wrap ? "pre-wrap" : "pre" }}>{line || " "}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
