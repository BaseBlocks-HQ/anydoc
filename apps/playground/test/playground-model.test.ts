import { describe, expect, it } from "vitest";
import { canPreview, fileExtension } from "../src/playground-model";

describe("playground model helpers", () => {
  it("reports only formats with native viewers as previewable", () => {
    expect(canPreview("DOCX")).toBe(true);
    expect(canPreview("xlsx")).toBe(true);
    expect(canPreview("rtf")).toBe(false);
  });

  it("normalizes filename extensions used by ingestion", () => {
    expect(fileExtension("notes.MD")).toBe("markdown");
    expect(fileExtension("report.TXT")).toBe("text");
    expect(fileExtension("presentation.PPTX")).toBe("pptx");
    expect(fileExtension("README")).toBeUndefined();
  });
});
