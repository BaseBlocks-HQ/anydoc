# Security model

All input files are untrusted. Viewer adapters operate on original bytes but do not execute document behavior.

## Required controls

- Reject negative, non-finite, or oversized byte/page/slide/cell counts before parsing.
- Keep AnyDoc archive entry, XML depth/node, decompression, and retained-asset limits intact.
- Never execute Office macros, PDF JavaScript, XFA, formulas, ActiveX, OLE objects, scripts, forms, or launch actions.
- Block external OOXML relationships and external workbook references. Hosts may expose ordinary hyperlinks only through an explicit callback and URL-policy decision.
- Do not render untrusted HTML. Markdown uses a sanitizer and DOCX output is constrained to the renderer-owned isolated tree.
- Do not fetch external document media automatically. Embedded media is loaded from bounded package bytes.
- Parse spreadsheet and large document data in workers where supported, transfer source buffers, support cancellation, and destroy renderer state on unmount.
- Treat MIME type and filename as hints. Hosts must authorize the file and verify format from bytes before selecting a viewer.

## Host responsibilities

The library does not own storage or authorization. Hosts must serve private documents through an authenticated endpoint or short-lived URL, apply `private, no-store` caching where appropriate, constrain CSP (`object-src 'none'`, bounded worker/blob policies), and preserve download authorization independently of preview access.

Security defects should be reported privately to the maintainers before public disclosure.
