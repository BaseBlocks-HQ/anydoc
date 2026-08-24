---
"@baseblocks/anydoc-contracts": patch
"@baseblocks/anydoc-viewer": patch
---

Place the PDF.js worker beside the compiled PDF viewer module so `new URL(..., import.meta.url)` resolves in bundlers.
