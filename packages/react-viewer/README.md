# `@baseblocks/anydoc-react-viewer`

Lazy, framework-neutral React viewers for PDF, DOCX, UTF-8 text, and sanitized Markdown. The package ships its PDF.js worker, blocks DOCX external resources by default, and does not depend on BaseBlocks or Glass UI packages.

```tsx
import { DocumentViewer } from "@baseblocks/anydoc-react-viewer";

<DocumentViewer
  format="pdf"
  source={{ url: signedUrl, headers: { Authorization: token } }}
  title="Report.pdf"
/>
```

`source` accepts an HTTP(S)/blob URL, `ArrayBuffer`, typed-array view, `Blob`, `{ data }`, or `{ url, headers, credentials }`. URL responses and in-memory sources are checked against `maxBytes` (100 MiB by default).

## Custom controls

Pass `renderControls` to replace the accessible default toolbar without reimplementing viewer state. Pass `controls={false}` for a fully headless surface.

```tsx
<DocumentViewer
  format="pdf"
  source={bytes}
  renderControls={({ pagination, search, zoom }) => (
    <nav aria-label="Document controls">
      <button disabled={!pagination || pagination.current <= 1} onClick={pagination?.previous}>Previous</button>
      <input aria-label="Search document" onChange={(event) => search?.setQuery(event.currentTarget.value)} />
      <button onClick={zoom?.zoomIn}>Zoom in</button>
    </nav>
  )}
/>
```

Every asynchronous failure is a `ViewerError` with a stable `code`, optional `format` and HTTP `status`. `onError` receives load, render, worker, and search errors. Cancellation through `signal` is silent and releases fetch/render work.

PDF continuous mode keeps at most `maxRenderedPages` canvases mounted (7 by default), and search scans at most `maxSearchPages` pages (250 by default) with four workers. DOCX is rendered in a detached DOM, sanitized, then attached; external URLs are removed unless `allowExternalResource` explicitly approves them. Markdown raw HTML passes through `rehype-sanitize`, and remote images are blocked unless enabled.
