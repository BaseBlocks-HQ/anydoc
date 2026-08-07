# Dependency and license audit

AnyDoc's viewer packages use only permissively licensed runtime dependencies. The release audit for `0.1.0-alpha.5` found MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, and compatible dual-license declarations. Package tarballs include this repository's MIT license and attribution notice.

Notable runtime boundaries:

- PDF.js (`pdfjs-dist`, Apache-2.0) executes parsing in its packaged worker and does not enable PDF JavaScript.
- `docx-preview` (Apache-2.0) renders DOCX markup with sanitizing options and external resource loading disabled by the host policy.
- `@aiden0z/pptx-renderer` (Apache-2.0) parses presentations locally; AnyDoc blocks automatic external media and delegates link navigation to the host.
- `@zip.js/zip.js`, `saxes`, and the spreadsheet engine parse XLSX archives under explicit archive, entry, cell, and string limits.
- `@firecrawl/anydoc` and its platform-specific native bindings (MIT) provide Node ingestion. The browser subpath uses `@firecrawl/anydoc-wasm` and loads it only on demand.

Before each release, run `pnpm licenses list --prod --json`, inspect newly introduced packages and transitive licenses, and review lockfile changes. Native bindings are optional per platform; the umbrella package repeats the upstream optional dependencies because some package managers do not install nested optional native packages reliably.
