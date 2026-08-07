# Viewer performance budgets

Performance is a release gate, measured on production builds with representative fixtures.

| Budget | Target |
| --- | --- |
| Umbrella core entry, minified before compression | 15 kB maximum |
| Core import | Must not import React, PDF.js, DOCX, spreadsheet, or PPTX engines |
| Initial format open | Load only the selected viewer chunk |
| PDF canvases/text layers mounted | At most 7 around the viewport |
| Spreadsheet DOM cells mounted | Viewport plus bounded overscan; never proportional to workbook size |
| PPTX rendered slides | Current slide plus virtualized thumbnails; at most 100 source slides |
| Main-thread parsing | Spreadsheet parsing runs in a worker; PDF uses the PDF.js worker |
| Source changes/unmount | Abort fetches and dispose workers/renderers deterministically |

PPTX ZIP expansion is bounded, but the upstream presentation parser currently runs on the main thread and only observes cancellation between its synchronous parse/build phases. The alpha therefore caps presentations at 100 slides. Moving OOXML parsing into a dedicated worker is an explicit post-v1 performance item; cancellation is not claimed to preempt an in-progress synchronous parse.

The corpus includes small representative documents plus long PDF, large sparse XLSX, large CSV, media-heavy PPTX, malformed ZIP/XML, external relationships, encrypted files, and archive-bomb fixtures. Release verification records package sizes, time-to-first-content, peak mounted renderers, worker count, and cancellation behavior.
