import { assertWithinByteLimit, DocumentPlatformError } from "@baseblocks/anydoc-contracts";

export function decodeTextContent(bytes, format = "text", limits) {
  if (format !== "text" && format !== "markdown") {
    throw new DocumentPlatformError("Text passthrough only supports text and Markdown.", {
      code: "invalid-source",
      format,
    });
  }
  assertWithinByteLimit(bytes.byteLength, format, limits);
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return Object.freeze({ format, text: value, markdown: format === "markdown" ? value : undefined });
  } catch (cause) {
    throw new DocumentPlatformError("The document is not valid UTF-8 text.", {
      cause,
      code: "invalid-text",
      format,
    });
  }
}
