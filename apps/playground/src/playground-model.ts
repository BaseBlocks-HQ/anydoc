const VIEWER_FORMATS = new Set(["csv", "docx", "markdown", "pdf", "pptx", "text", "xlsx"]);

export function canPreview(format: string): boolean {
  return VIEWER_FORMATS.has(format.toLowerCase());
}

export function fileExtension(filename: string): string | undefined {
  const extension = filename.includes(".") ? filename.split(".").at(-1)?.toLowerCase() : undefined;
  if (extension === "md" || extension === "mdown") return "markdown";
  if (extension === "txt") return "text";
  return extension;
}
