import type { DocumentLimits } from "@baseblocks/anydoc-contracts";

export interface TextContent {
  readonly format: "text" | "markdown";
  readonly text: string;
  readonly markdown?: string;
}

export declare function decodeTextContent(
  bytes: Uint8Array,
  format?: "text" | "markdown",
  limits?: DocumentLimits,
): TextContent;
