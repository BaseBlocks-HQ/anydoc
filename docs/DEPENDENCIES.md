# Dependency and license audit

AnyDoc's viewer packages use only permissively licensed runtime dependencies. The release audit for `0.1.0-alpha.5` found MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, and compatible dual-license declarations. Package tarballs include this repository's MIT license and attribution notice.

Notable runtime boundaries:

- PDF.js (`pdfjs-dist`, Apache-2.0) executes parsing in its packaged worker and does not enable PDF JavaScript.
- `docx-preview` (Apache-2.0) renders DOCX markup with sanitizing options and external resource loading disabled by the host policy.
- `@aiden0z/pptx-renderer` (Apache-2.0) parses presentations locally; AnyDoc blocks automatic external media and delegates link navigation to the host.
- `@zip.js/zip.js` parses DOCX archives for sanitization under explicit entry and size limits; the spreadsheet viewer parses XLSX with its own Rust/Wasm engine (`spreadsheet-view` crate) under the same archive, part, cell, and string limits, so no spreadsheet-specific npm dependencies remain.
- `@firecrawl/anydoc` and its platform-specific native bindings (MIT) provide Node ingestion. The browser subpath uses `@firecrawl/anydoc-wasm` and loads it only on demand.
- Consumers of this repository's npm packages pin the upstream binding family (`@firecrawl/anydoc`, `@firecrawl/anydoc-wasm`) to the version this repository last tagged (`v0.1.9`). The BaseBlocks app previously installed `0.1.8`; moving to `0.1.9` tracks the upstream sync already validated here by the fixture snapshot corpus, robustness tests, and fuzz targets.

Before each release, run `pnpm licenses list --prod --json`, inspect newly introduced packages and transitive licenses, and review lockfile changes. Native bindings are optional per platform; the umbrella package repeats the upstream optional dependencies because some package managers do not install nested optional native packages reliably.
