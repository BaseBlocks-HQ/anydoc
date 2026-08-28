# @baseblocks/anydoc-viewer

Framework-neutral document viewer engine and React adapter for AnyDoc. Render
PDF, DOCX, XLSX/CSV, PPTX, text, and Markdown files in the browser with bounded
resources; every file is treated as untrusted input.

## Install

```bash
npm install @baseblocks/anydoc-viewer react react-dom
```

## Universal React viewer

```tsx
import { AnyDocumentViewer } from '@baseblocks/anydoc-viewer/react';

<AnyDocumentViewer source={fileOrBytes} filename="report.xlsx" />
```

The component detects the format from bytes and content type, lazily loads only
the requested format renderer, and reports its control model through
`onControls` so hosts can render their own toolbar.

## Headless entry

The root entry has no React dependency:

```ts
import {
  detectViewerFormatFromBytes,
  loadDocumentBytes,
  sanitizeDocxArchive,
  ViewerError,
} from '@baseblocks/anydoc-viewer';
```

It also exposes the spreadsheet read engine (`SpreadsheetReadSession`,
`SpreadsheetEngine`) used by the React grid, plus pure layout models
(`axis-layout`, `scroll-projection`, `viewport-model`).

The read-only spreadsheet grid renders legacy XLSX form-control checkboxes,
including their checked state and caption, in the cell where each control is
anchored.

## Structure

- `.` — headless engine: format detection, byte loading, security primitives,
  errors, spreadsheet read engine.
- `/react` — everything above plus `AnyDocumentViewer`, per-format viewers,
  `SpreadsheetViewer`, `PresentationViewer`, and the shared toolbar.

## Safety model

Viewers enforce byte, page, cell, and slide limits from
`@baseblocks/anydoc-contracts`, block external media and active HTML by
default, and never execute macros or formulas. See
[`docs/SECURITY.md`](../../docs/SECURITY.md).
