# AnyDoc viewer platform (alpha)

This package is the optional visual surface for AnyDoc. Ingestion remains in the Rust/WASM/Node core and its normalized document model; viewers consume original source bytes and never render extracted Markdown as a fidelity substitute.

The default entry point contains only capability/security contracts and a lazy adapter registry. PDF, DOCX, spreadsheet, and PPTX dependencies are loaded through explicit format adapters so ingestion-only consumers do not pay their cost. Hosts provide the concrete React/headless renderer and worker URLs appropriate to their bundler.

## Security contract

Documents are untrusted. Adapters must enforce bounded bytes/pages/cells/slides, disable macros/scripts/formulas/external references, block external media by default, and expose structured errors. `isSafeExternalUrl`, `sanitizeFilename`, and `createAbortScope` are small shared primitives for hosts.

## Capability matrix

| Format | Native viewer | Alpha policy |
|---|---:|---|
| text / Markdown | Yes | Bounded, inert text; Markdown must be AST-sanitized and remote images blocked |
| PDF | Yes | PDF.js worker, lazy pages, scripts/XFA/forms/launches disabled |
| DOCX | Yes | Safe renderer; no macros, OLE, or external relationships |
| XLSX / CSV | Yes | Virtualized grid; formulas and external references inert |
| PPTX | Yes | Lazy static slides; external media and playback blocked |

DOC/DOCM, XLS/XLSM/XLSB, PPT/PPS/POT/PPTM/PPSX/PPSM, ODT/ODS/ODP, RTF, EPUB, and scanned/image-only PDF are ingestion-supported but not claimed as native viewers in v1.
