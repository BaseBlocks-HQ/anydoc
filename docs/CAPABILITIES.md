# AnyDoc capability matrix

AnyDoc has two deliberately separate capabilities: semantic ingestion and native viewing. Ingestion produces the normalized AnyDoc content model, Markdown, text, and assets. Native viewers render the original source bytes with a format-specific engine.

| Format | Ingestion | Native viewing | Initial viewer behavior |
| --- | --- | --- | --- |
| Text | UTF-8 passthrough | Yes | Bounded inert text with search and copy |
| Markdown | UTF-8 passthrough | Yes | Sanitized Markdown; raw HTML and automatic remote media are disabled |
| PDF | Yes for text PDFs | Yes | PDF.js worker, virtualized pages, text search, selection, navigation, and zoom |
| DOCX | Yes | Yes | `docx-preview`, page layout, search, selection, and zoom; external relationships blocked |
| XLSX | Yes | Yes | Worker-backed sparse model, virtualized sheets, styles, charts, search, selection, and copy |
| CSV | Yes | Yes | Spreadsheet surface with inert formula-like values and bounded rows/cells |
| PPTX | Yes | Yes | Lazy slides/media, thumbnails, navigation, search, zoom; external media blocked |
| DOC / DOCM | Yes | No | Post-v1. Macros are never executed |
| XLS / XLSM / XLSB | Yes | No | Post-v1. Macros, formulas, and external workbook references are never executed |
| PPT / PPS / POT / PPTM / PPSX / PPSM | Yes | No | Post-v1. Macros and active media are never executed |
| ODT / ODS / ODP | Yes | No | Post-v1 |
| RTF | Yes | No | Post-v1 |
| EPUB | Yes | No | Post-v1; active HTML is not a native viewer substitute |
| Image-only/scanned PDF | No OCR | PDF pages only | Visual PDF viewing works; semantic ingestion requires a future host-provided OCR pipeline |

“Native viewing” never implies editing, macro execution, active content, perfect Office round-tripping, or automatic external-resource retrieval.
