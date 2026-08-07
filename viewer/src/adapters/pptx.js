export const format = "pptx";
export const dependency = "static PPTX renderer adapter";
export function createPptxPolicy() { return { lazySlides: true, blockExternalMedia: true, playMedia: false, executeScripts: false, maxSlides: 200 }; }
