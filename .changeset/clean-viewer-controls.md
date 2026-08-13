---
"@baseblocks/anydoc-viewer-ui": patch
"@baseblocks/anydoc-react-viewer": patch
"@baseblocks/anydoc-presentation-viewer": patch
"@baseblocks/anydoc-spreadsheet-viewer": patch
---

Replace the format-specific control APIs with one accessible control model and Pierre icon toolbar. This is an intentional breaking alpha change: consumers must replace `renderControls` and `showDefaultControls` with `controls` and `onControls`.

Add collapsed search without empty result controls, a shared document stage, bounded playground panes, viewport-fitted DOCX pages, a scrollable PowerPoint thumbnail rail, and safely centered PowerPoint slides.
