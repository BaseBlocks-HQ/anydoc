# AnyDoc platform (alpha)

This is the temporary `@baseblocks/anydoc` distribution for the AnyDoc platform alpha. It exposes the existing native Node ingestion API through `@baseblocks/anydoc/node`, a lazy browser WASM API through `@baseblocks/anydoc/browser`, and format-native React viewers through lazy subpackages. The normalized content model remains separate from native render models; viewers consume original source bytes and never render extracted Markdown as a fidelity substitute.

For ingestion-only use, install the lightweight umbrella package:

```bash
npm install @baseblocks/anydoc
```

For the complete native viewer surface, install the optional implementations once; application code still imports through `@baseblocks/anydoc` subpaths:

```bash
npm install @baseblocks/anydoc @baseblocks/anydoc-react-viewer \
  @baseblocks/anydoc-spreadsheet-engine @baseblocks/anydoc-spreadsheet-viewer \
  @baseblocks/anydoc-presentation-viewer
```

```ts
import { toMarkdown, toDocument } from "@baseblocks/anydoc/node";
import { decodeTextContent, getCapabilities } from "@baseblocks/anydoc";
import { loadViewerAdapter } from "@baseblocks/anydoc/adapters";

const markdown = await toMarkdown("report.docx");
const contentModel = await toDocument(bytes);
const plainText = decodeTextContent(textBytes, "text");
const viewer = await loadViewerAdapter("docx");
```

The default entry point contains only capability/security contracts and a lazy adapter registry. PDF, DOCX, spreadsheet, and PPTX dependencies are loaded through explicit format adapters so ingestion-only consumers do not pay their cost. Hosts provide the concrete React/headless renderer and worker URLs appropriate to their bundler.

## Security contract

Documents are untrusted. Adapters must enforce bounded bytes/pages/cells/slides, disable macros/scripts/formulas/external references, block external media by default, and expose structured errors. `isSafeExternalUrl`, `sanitizeFilename`, and `createAbortScope` are small shared primitives for hosts.

## Capability matrix

| Format | Native viewer | Alpha policy |
|---|---:|---|
| text / Markdown | Yes | Bounded, inert text; Markdown must be AST-sanitized and remote images blocked |
| PDF | Yes | PDF.js worker and bounded virtual pages; scripts/XFA/forms/launches disabled |
| DOCX | Yes | Safe renderer; no macros, OLE, or external relationships |
| XLSX / CSV | Yes | Worker-backed virtualized grid; formulas and external references inert |
| PPTX | Yes | Lazy slides/media; external media and playback blocked |

DOC/DOCM, XLS/XLSM/XLSB, PPT/PPS/POT/PPTM/PPSX/PPSM, ODT/ODS/ODP, RTF, and EPUB are ingestion-supported but not claimed as native viewers in v1. Scanned/image-only PDFs remain visually viewable but require a future OCR pipeline for semantic ingestion.
