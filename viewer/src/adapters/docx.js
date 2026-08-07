export const format = "docx";
export const dependency = "docx-preview";
export function createDocxPolicy() { return { ignoreWidth: false, breakPages: true, useBase64URL: true, noExternalResources: true, noMacros: true }; }
