# `@baseblocks/anydoc`

The one-install AnyDoc platform: safe browser and Node ingestion plus universal
format-native React viewers.

```bash
npm install @baseblocks/anydoc react react-dom
```

```tsx
import { AnyDocumentViewer } from "@baseblocks/anydoc/react";

<AnyDocumentViewer source={fileOrUrlOrBytes} filename="report.docx" />
```

The viewer detects supported signatures and lazy-loads only the active document
family. Its unified controls can be hidden, observed, transformed, replaced, or
rendered into another toolbar:

```tsx
<AnyDocumentViewer
  source={file}
  controls={{
    target: toolbarElement,
    transform: (controls) => ({
      ...controls,
      actions: controls.actions.filter((action) => action.id !== "appearance"),
    }),
  }}
  onControls={(controls) => commands.set(controls)}
/>
```

Use `@baseblocks/anydoc/node` for paths, files, blobs, or bytes and
`@baseblocks/anydoc/browser` for browser files, blobs, bytes, or explicitly
allowed URLs. The umbrella preserves the advanced `/sources`, `/persistence`,
and `/ingestion` subpaths.

Server frameworks, queues, and actions that do not render documents should
depend directly on `@baseblocks/anydoc-ingestion`. That boundary deliberately
excludes React, viewer, spreadsheet-renderer, presentation-renderer, and browser
WASM dependencies.
