import { ingest, type PlaygroundIngestionResult } from "./ingest.js";
import { AnyDocumentViewer, type ViewerFormat } from "@baseblocks/anydoc-viewer/react";
import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import firecrawlLogoUrl from "../../../wasm/www/assets/logo.svg?url";
import { canPreview, fileExtension } from "./playground-model";
import { playgroundSamples, type PlaygroundSample } from "./samples";
import "./styles.css";

type IngestionResult = PlaygroundIngestionResult;
type Theme = "dark" | "light";

const ACCEPTED_EXTENSIONS = [
  ".csv", ".doc", ".docm", ".docx", ".epub", ".md", ".markdown", ".odp", ".ods", ".odt",
  ".pdf", ".pot", ".pps", ".ppsm", ".ppsx", ".ppt", ".pptm", ".pptx", ".rtf", ".text", ".txt",
  ".xls", ".xlsb", ".xlsm", ".xlsx",
].join(",");

function Frame() {
  return (
    <svg className="frame" aria-hidden="true">
      <line x1="0.5" y1="0" x2="0.5" y2="100%" />
      <line x1="100%" y1="0" x2="100%" y2="100%" transform="translate(-0.5 0)" />
    </svg>
  );
}

function Junction({ edge }: { readonly edge: "bottom" | "top" }) {
  return (
    <svg className={`junction ${edge}`} aria-hidden="true">
      <line x1="0" y1="10.5" x2="100%" y2="10.5" />
      <path d="M4 0H11V7H10C10 3.686 7.314 1 4 1V0Z" fill="currentColor" transform="rotate(180 5.5 5.5)" />
      <path d="M4 0H11V7H10C10 3.686 7.314 1 4 1V0Z" fill="currentColor" transform="translate(0 10) rotate(-90 5.5 5.5)" />
      <svg x="100%" overflow="visible">
        <path d="M4 0H11V7H10C10 3.686 7.314 1 4 1V0Z" fill="currentColor" transform="translate(-11 0) rotate(90 5.5 5.5)" />
        <path d="M4 0H11V7H10C10 3.686 7.314 1 4 1V0Z" fill="currentColor" transform="translate(-11 10)" />
      </svg>
    </svg>
  );
}

function BaseBlocksMark() {
  return (
    <svg className="baseblocks-mark" viewBox="0 0 270 228" aria-hidden="true">
      <path d="M222.79 35.2C220.14 32.55 217.49 29.89 214.83 27.24C206.88 18.75 198.39 10.26 187.78 4.95C175.58-1.42 162.32.18 149.06.18H48.8L68.96 27.24H189.37C200.51 27.24 210.06 29.36 219.08 35.2C220.67 35.73 222.26 35.73 222.79 35.2Z" />
      <path d="M245.07 78.71C242.42 76.06 239.76 73.41 237.11 70.75C229.16 62.26 220.67 53.77 210.06 48.47C197.86 42.1 184.6 43.69 171.34 43.69H82.22L102.38 70.75H212.18C223.32 70.75 232.87 72.88 241.89 78.71C242.95 79.24 244.01 79.24 245.07 78.71Z" />
      <path d="M270 121.16C267.35 118.51 264.7 115.86 262.04 113.2C254.09 104.71 245.6 96.22 234.99 90.92C222.79 84.55 209.53 86.14 196.27 86.14H114.58L134.74 113.2H236.58C247.72 113.2 257.27 115.33 266.29 121.16C267.88 121.69 268.94 122.23 270 121.16Z" />
      <path d="M46.68 192.8C49.33 195.45 51.98 198.11 54.64 200.76C62.59 209.25 71.08 217.74 81.69 223.05C93.89 229.42 107.15 227.82 120.41 227.82H220.67L200.51 200.76H80.1C68.96 200.76 59.41 198.64 50.39 192.8C48.8 192.27 47.74 192.27 46.68 192.8Z" />
      <path d="M24.4 149.29C27.05 151.94 29.71 154.59 32.36 157.25C40.31 165.74 48.8 174.23 59.41 179.54C71.61 185.9 84.87 184.31 98.13 184.31H187.25L167.09 157.25H57.29C46.15 157.25 36.6 155.13 27.58 149.29C26.52 148.76 25.46 148.76 24.4 149.29Z" />
      <path d="M0 106.31C2.65 108.96 5.3 111.61 7.96 114.27C15.91 122.76 24.4 131.25 35.01 136.55C47.21 142.92 60.47 141.33 73.73 141.33H155.42L135.27 114.27H33.42C22.28 114.27 12.73 112.14 3.71 106.31C2.12 105.78 1.06 105.78 0 106.31Z" />
    </svg>
  );
}

function Icon({ children, size = 16 }: { readonly children: ReactNode; readonly size?: number }) {
  return <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>{children}</svg>;
}

function ThemeButton({ onToggle, theme }: { readonly onToggle: () => void; readonly theme: Theme }) {
  return (
    <button className="icon-button" onClick={onToggle} type="button" aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}>
      {theme === "dark" ? (
        <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></Icon>
      ) : (
        <Icon><path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5 8.5 8.5 0 1 0 20.5 14.1Z" /></Icon>
      )}
    </button>
  );
}

function Badge({ href, label, value }: { readonly href: string; readonly label: string; readonly value: string }) {
  return <li><a href={href}><span className="key">{label}</span><span className="value">{value}</span></a></li>;
}

function EmptyPreview({ format }: { readonly format?: string }) {
  return (
    <div className="empty-preview">
      <span className="empty-preview-icon"><Icon size={22}><path d="M7 3h7l4 4v14H7V3Z" /><path d="M14 3v5h5M10 13h5M10 17h5" /></Icon></span>
      <strong>{format ? `No native ${format.toUpperCase()} preview yet` : "Preview appears here"}</strong>
      <p>{format ? "This format still parses into Markdown; the viewer capability is intentionally reported separately." : "Choose a supported document to exercise the embeddable viewer."}</p>
    </div>
  );
}

function Playground() {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<IngestionResult>();
  const [duration, setDuration] = useState<number>();
  const [error, setError] = useState<string>();
  const [processing, setProcessing] = useState(false);
  const [sampleLoading, setSampleLoading] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function openDocument(nextFile: File) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFile(nextFile);
    setResult(undefined);
    setDuration(undefined);
    setError(undefined);
    setProcessing(true);
    setCopied(false);
    const started = performance.now();
    try {
      const nextResult = await ingest(nextFile, {
        contentType: nextFile.type || undefined,
        filename: nextFile.name,
        format: fileExtension(nextFile.name),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResult(nextResult);
      setDuration(Math.max(1, Math.round(performance.now() - started)));
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "AnyDoc could not process this document.");
    } finally {
      if (!controller.signal.aborted) setProcessing(false);
    }
  }

  async function openSample(sample: PlaygroundSample) {
    setSampleLoading(sample.format);
    try {
      await openDocument(await sample.load());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The sample could not be loaded.");
    } finally {
      setSampleLoading(undefined);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void openDocument(dropped);
  }

  async function copyMarkdown() {
    if (!result) return;
    await navigator.clipboard.writeText(result.markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function downloadMarkdown() {
    if (!result || !file) return;
    const url = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown" }));
    const anchor = Object.assign(document.createElement("a"), {
      download: `${file.name.replace(/\.[^.]*$/, "") || "document"}.md`,
      href: url,
    });
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const previewable = result ? canPreview(result.format) : false;

  return (
    <>
      <section className="band upload-band" id="playground">
        <button
          className={`drop ${dragging ? "over" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          type="button"
        >
          <span className="drop-icon"><Icon size={20}><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5" /></Icon></span>
          <span className="big">Drop a document here</span>
          <span className="small">or <u>browse</u> for one · files never leave your machine</span>
        </button>
        <input
          accept={ACCEPTED_EXTENSIONS}
          hidden
          onChange={(event) => {
            const selected = event.currentTarget.files?.[0];
            if (selected) void openDocument(selected);
            event.currentTarget.value = "";
          }}
          ref={inputRef}
          type="file"
        />
        <div className="samples" aria-label="Sample documents">
          <span>No document at hand?</span>
          <div className="sample-list">
            {playgroundSamples.map((sample) => (
              <button disabled={sampleLoading !== undefined} key={sample.format} onClick={() => void openSample(sample)} title={sample.description} type="button">
                {sampleLoading === sample.format ? "Loading…" : sample.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {(file || processing || error) && (
        <section className="band result" aria-labelledby="result-heading">
          <div className="result-bar">
            <div className="document-meta">
              <h2 id="result-heading">{file?.name ?? "Document"}</h2>
              <span className="result-arrow" aria-hidden="true">→</span>
              <p aria-live="polite" role="status">
                {processing ? "Parsing locally…" : error ? "Conversion failed" : result ? `${result.format} · ${result.markdown.length.toLocaleString()} chars · ${duration} ms` : "Preparing document…"}
              </p>
            </div>
            <div className="result-actions">
              <button disabled={!result} onClick={() => void copyMarkdown()} type="button">{copied ? "Copied" : "Copy"}</button>
              <button disabled={!result} onClick={downloadMarkdown} type="button">Download .md</button>
            </div>
          </div>

          {error ? (
            <div className="error-state" role="alert"><strong>Could not process this document.</strong><span>{error}</span></div>
          ) : (
            <div className="workspace" aria-busy={processing}>
              <section className="workspace-pane" aria-label="Native document preview">
                <div className="pane-body viewer-stage">
                  {processing ? <div className="loading-state"><span className="spinner" /> Opening document…</div> : null}
                  {!processing && result && previewable && file ? (
                    <AnyDocumentViewer
                      error={(nextError) => <div className="viewer-error" role="alert">{nextError.message}</div>}
                      filename={file.name}
                      format={result.format as ViewerFormat}
                      key={`${file.name}-${file.lastModified}`}
                      loading={<div className="loading-state"><span className="spinner" /> Loading viewer…</div>}
                      source={file}
                    />
                  ) : null}
                  {!processing && (!result || !previewable) ? <EmptyPreview format={result?.format} /> : null}
                </div>
              </section>

              <section className="workspace-pane" aria-label="Extracted Markdown">
                <div className="pane-body output-stage">
                  {processing ? <div className="loading-state"><span className="spinner" /> Converting to Markdown…</div> : null}
                  {!processing && result?.markdown ? <pre className="output"><code>{result.markdown}</code></pre> : null}
                </div>
              </section>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="page">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="top rail">
        <Frame />
        <a className="lockup" href="https://github.com/BaseBlocks-HQ/anydoc" aria-label="AnyDoc by BaseBlocks on GitHub">
          <BaseBlocksMark />
          <span className="wordmark">AnyDoc <span className="by">by BaseBlocks</span></span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#playground">Playground</a>
          <a href="https://github.com/BaseBlocks-HQ/anydoc">GitHub</a>
          <a className="pkg" href="https://www.npmjs.com/package/@baseblocks/anydoc-viewer">npm</a>
          <a className="pkg" href="https://crates.io/crates/anydoc">crates.io</a>
          <ThemeButton onToggle={() => setTheme((value) => value === "dark" ? "light" : "dark")} theme={theme} />
        </nav>
      </header>

      <main className="rail" id="main-content">
        <Frame />
        <Junction edge="top" />
        <Junction edge="bottom" />

        <section className="band hero">
          <div className="fork-note">
            <span className="baseblocks-dot"><BaseBlocksMark /></span>
            <span>BaseBlocks-maintained fork</span>
            <span className="fork-separator" aria-hidden="true">×</span>
            <a href="https://github.com/firecrawl/anydoc"><img alt="" src={firecrawlLogoUrl} /> Built on Firecrawl AnyDoc</a>
          </div>
          <h1>Any document in.<br /><span className="heat">Markdown and preview out.</span></h1>
          <p className="lede">The fast open-source Rust parser from Firecrawl, complemented by embeddable BaseBlocks viewers for PDF, Word, Excel, PowerPoint, Markdown, and text. Parse and preview locally: <strong>files never leave your machine</strong>.</p>
          <ul className="badges">
            <Badge href="https://www.npmjs.com/package/@baseblocks/anydoc-viewer" label="npm" value="@baseblocks/anydoc-viewer" />
            <Badge href="https://crates.io/crates/anydoc" label="crates.io" value="anydoc" />
            <Badge href="https://www.npmjs.com/package/@firecrawl/anydoc" label="npm" value="@firecrawl/anydoc" />
            <Badge href="https://pypi.org/project/firecrawl-anydoc/" label="PyPI" value="firecrawl-anydoc" />
            <Badge href="https://skills.sh/firecrawl/anydoc" label="skills.sh" value="firecrawl/anydoc" />
            <Badge href="https://github.com/BaseBlocks-HQ/anydoc/blob/main/LICENSE" label="license" value="MIT" />
          </ul>
        </section>

        <Playground />

        <section className="band">
          <h2>About</h2>
          <dl className="facts">
            <dt>One model</dt><dd><strong>Every upstream format parses into the same document model</strong> and renders through one Markdown serializer, so headings, nested lists, merged table cells, and footnotes behave consistently—from a .doc written in 2003 to yesterday’s .pptx.</dd>
            <dt>Two surfaces</dt><dd><strong>Parsing and viewing stay complementary.</strong> Markdown is built for search, agents, and content workflows; format-native viewers let people inspect the source document inside an application.</dd>
            <dt>Detection</dt><dd>The format is read from the bytes, not only the extension, so mislabeled files still convert. Signature-less CSV and text use their filename or explicit format.</dd>
            <dt>Speed</dt><dd>Pure Rust, no ML models, no services: median upstream conversion is under 5 ms. Of seven converters <a href="https://github.com/firecrawl/anydoc#benchmark">benchmarked</a> on 100 documents, AnyDoc was the only one to handle all fourteen tested formats.</dd>
            <dt>Viewers</dt><dd>BaseBlocks adds bounded, lazy viewers for PDF, DOCX, XLSX, CSV, PPTX, Markdown, and text. Macros, formulas, scripts, external media, and active HTML are never executed automatically.</dd>
            <dt>PDF</dt><dd>Text-based PDFs convert locally through <a href="https://github.com/firecrawl/pdf-inspector">pdf-inspector</a>. Scanned pages remain visually viewable with PDF.js; semantic extraction requires OCR such as <a href="https://firecrawl.dev/parse">Firecrawl Parse</a>.</dd>
            <dt>This page</dt><dd>The playground uses <a href="https://www.npmjs.com/package/@baseblocks/anydoc-viewer">@baseblocks/anydoc-viewer</a> and <a href="https://www.npmjs.com/package/@firecrawl/anydoc-wasm">@firecrawl/anydoc-wasm</a>, including <a href="https://www.npmjs.com/package/@firecrawl/anydoc-wasm">@firecrawl/anydoc-wasm</a> and the same viewer interfaces applications embed. Drop them into your own app the same way.</dd>
            <dt>Provenance</dt><dd>This repository is a <a href="https://github.com/BaseBlocks-HQ/anydoc">BaseBlocks-maintained fork</a> of <a href="https://github.com/firecrawl/anydoc">Firecrawl AnyDoc</a>. Upstream parsing and BaseBlocks additions are distributed under MIT.</dd>
          </dl>
        </section>

        <section className="band">
          <h2>Install</h2>
          <dl className="installs">
            <dt>Viewer platform</dt><dd><span className="dollar">$</span> <code className="cmd">npm install @baseblocks/anydoc-viewer react react-dom</code></dd>
            <dt>Rust parser</dt><dd><span className="dollar">$</span> <code className="cmd">cargo add anydoc</code></dd>
            <dt>Node parser</dt><dd><span className="dollar">$</span> <code className="cmd">npm install @firecrawl/anydoc</code></dd>
            <dt>Python parser</dt><dd><span className="dollar">$</span> <code className="cmd">pip install firecrawl-anydoc</code></dd>
            <dt>Browser parser</dt><dd><span className="dollar">$</span> <code className="cmd">npm install @firecrawl/anydoc-wasm</code></dd>
            <dt>CLI</dt><dd><span className="dollar">$</span> <code className="cmd">npx @firecrawl/anydoc report.docx</code></dd>
            <dt>Agent skill</dt><dd><span className="dollar">$</span> <code className="cmd">npx skills add firecrawl/anydoc</code></dd>
          </dl>
          <p className="prose install-note">The parser API is the same everywhere: convert from a path or from bytes, or stop at the document model and keep the embedded assets. Install <code>@baseblocks/anydoc-viewer</code> for the universal viewer, or <code>@firecrawl/anydoc-wasm</code> for parsing alone. See the <a href="https://github.com/BaseBlocks-HQ/anydoc#quick-start">README</a>.</p>
        </section>
      </main>

      <footer className="rail">
        <Frame />
        <span>MIT license</span>
        <a href="https://github.com/BaseBlocks-HQ/anydoc">Source</a>
        <a href="https://github.com/BaseBlocks-HQ/anydoc/issues">Issues</a>
        <a href="https://baseblocks.dev">BaseBlocks</a>
        <a href="https://firecrawl.dev">Built by Firecrawl</a>
        <a href="https://github.com/firecrawl/anydoc">Original repository</a>
      </footer>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The AnyDoc playground root is missing.");
createRoot(rootElement).render(<StrictMode><App /></StrictMode>);
