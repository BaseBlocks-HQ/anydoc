---
"@baseblocks/anydoc-contracts": patch
"@baseblocks/anydoc-viewer": patch
---

Replace the TypeScript spreadsheet engine with a Rust/Wasm parser. The `spreadsheet-view` crate parses XLSX and CSV fully at open — archive limits, styles, number/date display, hyperlinks, drawings, charts, conditional-format rules, tables, and pivots — and ships as a lazily loaded asset inside `@baseblocks/anydoc-viewer`. The engine's editing framework dies with it; the read session keeps its query surface unchanged.
