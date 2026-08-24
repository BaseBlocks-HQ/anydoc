import { memo, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from "react";
import GithubSlugger from "github-slugger";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { ViewerControlRegion, viewerRootStyle, viewerScrollerStyle } from "../controls.js";
import { useAbortableValue } from "../hooks.js";
import { clearSearchHighlights, highlightText } from "../security.js";
import { decodeUtf8, loadDocumentBytes } from "../source.js";
import type { MarkdownViewerProps, ViewerControls } from "../types.js";

interface Heading { readonly depth: number; readonly id: string; readonly label: string }

function markdownHeadings(markdown: string): Heading[] {
  const slugger = new GithubSlugger();
  return markdown.split(/\r?\n/u).flatMap((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(line);
    if (!match?.[1] || !match[2]) return [];
    const label = match[2].replace(/[*_`[\]]/gu, "");
    return [{ depth: match[1].length, id: `anydoc-${slugger.slug(label)}`, label }];
  });
}

const sanitizedSchema = {
  ...defaultSchema,
  clobberPrefix: "anydoc-",
};

function SafeImage({ allowRemoteImages, alt, src, ...props }: ComponentPropsWithoutRef<"img"> & { readonly allowRemoteImages: boolean }) {
  if (!src) return null;
  let safe = src.startsWith("data:image/") || src.startsWith("blob:");
  if (allowRemoteImages) {
    try {
      safe ||= new Set(["http:", "https:"]).has(new URL(src, globalThis.location?.href).protocol);
    } catch {
      safe = false;
    }
  }
  return safe ? <img {...props} alt={alt ?? ""} loading="lazy" src={src} /> : <span role="img" aria-label={alt || "Blocked image"}>[{alt || "image blocked"}]</span>;
}

const MarkdownBody = memo(function MarkdownBody({ allowRemoteImages, markdown }: { readonly allowRemoteImages: boolean; readonly markdown: string }) {
  const components = useMemo(() => ({
    a: ({ children, href, ...props }: ComponentPropsWithoutRef<"a">) => <a {...props} href={href} rel="noopener noreferrer" target="_blank">{children}</a>,
    img: (props: ComponentPropsWithoutRef<"img">) => <SafeImage {...props} allowRemoteImages={allowRemoteImages} />,
  }), [allowRemoteImages]);
  return (
    <ReactMarkdown
      components={components}
      rehypePlugins={[rehypeRaw, rehypeSlug, [rehypeSanitize, sanitizedSchema]]}
      remarkPlugins={[remarkGfm]}
      urlTransform={defaultUrlTransform}
    >
      {markdown}
    </ReactMarkdown>
  );
});

export default function MarkdownViewer({
  allowRemoteImages = false,
  className,
  controls: showControls = true,
  maxBytes,
  onError,
  onControls,
  signal,
  source,
  style,
  title,
}: MarkdownViewerProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const matchesRef = useRef<HTMLElement[]>([]);
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resultIndex, setResultIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const state = useAbortableValue(
    async (abortSignal) => decodeUtf8(await loadDocumentBytes(source, { format: "markdown", ...(maxBytes === undefined ? {} : { maxBytes }), signal: abortSignal }), "markdown"),
    [source, maxBytes, signal],
    { code: "fetch-failed", format: "markdown", message: "Unable to open the Markdown document." },
    signal,
    onError,
  );
  const markdown = state.status === "ready" ? state.value : "";
  const headings = useMemo(() => markdownHeadings(markdown), [markdown]);

  useEffect(() => {
    const root = contentRef.current;
    if (!root || state.status !== "ready") return;
    const matches = highlightText(root, query);
    matchesRef.current = matches;
    setMatchCount(matches.length);
    setResultIndex(0);
    return () => {
      clearSearchHighlights(root);
      matchesRef.current = [];
    };
  }, [mode, query, state.status]);

  const moveResult = (delta: number) => {
    if (matchesRef.current.length === 0) return;
    const next = (resultIndex + delta + matchesRef.current.length) % matchesRef.current.length;
    setResultIndex(next);
    matchesRef.current[next]?.scrollIntoView({ block: "center" });
  };
  const viewerControls: ViewerControls = {
    actions: [
      { id: "mode", label: mode === "rendered" ? "Show source" : "Show rendered", pressed: mode === "source", run: () => setMode((value) => value === "rendered" ? "source" : "rendered") },
      { id: "outline", label: "Outline", pressed: outlineOpen, run: () => setOutlineOpen((value) => !value) },
    ],
    format: "markdown",
    search: { current: matchCount > 0 ? resultIndex + 1 : 0, next: () => moveResult(1), pending: false, previous: () => moveResult(-1), query, setQuery, total: matchCount },
    status: state.status,
    ...(title === undefined ? {} : { title }),
  };

  return (
    <section aria-label={title ? `Markdown viewer: ${title}` : "Markdown viewer"} className={className} style={{ ...viewerRootStyle, ...style }}>
      <ViewerControlRegion controls={viewerControls} onControls={onControls} setting={showControls} />
      {state.status === "error" ? <div role="alert" style={{ margin: "auto", padding: "1rem" }}>{state.error.message}</div> : null}
      {state.status === "loading" ? <div aria-live="polite" role="status" style={{ margin: "auto", padding: "1rem" }}>Opening Markdown…</div> : null}
      {state.status === "ready" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {outlineOpen ? (
            <nav aria-label="Document outline" style={{ borderInlineEnd: "1px solid color-mix(in srgb, currentColor 18%, transparent)", flex: "0 0 min(16rem, 35%)", overflowY: "auto", padding: "0.75rem" }}>
              {headings.length === 0 ? <p>No headings</p> : headings.map((heading) => (
                <a href={`#${heading.id}`} key={heading.id} style={{ display: "block", padding: "0.25rem", paddingInlineStart: `${heading.depth * 0.5}rem` }}>{heading.label}</a>
              ))}
            </nav>
          ) : null}
          <div ref={contentRef} style={{ ...viewerScrollerStyle, padding: "clamp(1rem, 4vw, 2.5rem)" }} tabIndex={0}>
            {mode === "rendered" ? <article style={{ margin: "0 auto", maxWidth: "52rem" }}><MarkdownBody allowRemoteImages={allowRemoteImages} markdown={markdown} /></article> : <pre style={{ margin: "0 auto", maxWidth: "64rem", whiteSpace: "pre-wrap" }}>{markdown}</pre>}
          </div>
        </div>
      ) : null}
    </section>
  );
}
