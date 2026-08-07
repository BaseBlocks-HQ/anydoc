export const format = "pdf";
export const dependency = "pdfjs-dist / react-pdf";
export function createPdfPolicy() {
  return { disableAutoFetch: true, disableStream: false, isEvalSupported: false, enableXfa: false, renderForms: false, allowExternalLinks: false };
}
