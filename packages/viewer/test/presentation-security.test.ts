// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPresentation, parseZipLazyMedia, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";

import { blockExternalPresentationMedia } from "../src/presentation/security.js";

function relationshipOwner() {
  return {
    rels: new Map([
      ["embedded", { target: "../media/image1.png", type: "image" }],
      [
        "external-image",
        { target: "https://tracker.example/image.png", targetMode: " External ", type: "image" },
      ],
      [
        "external-video",
        { target: "https://tracker.example/video.mp4", targetMode: "EXTERNAL", type: "video" },
      ],
      [
        "hyperlink",
        {
          target: "https://example.com",
          targetMode: "External",
          type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        },
      ],
    ]),
  };
}

describe("blockExternalPresentationMedia", () => {
  it("opens a representative PPTX corpus file through bounded lazy parsing", async () => {
    const bytes = await readFile(resolve(process.cwd(), "../../tests/fixtures/pptx/pres.pptx"));
    const source = new Uint8Array(bytes) as unknown as ArrayBuffer;
    const files = await parseZipLazyMedia(source, RECOMMENDED_ZIP_LIMITS);
    const presentation = await buildPresentation(files, { lazySlides: true });
    expect(presentation.slides.length).toBeGreaterThan(0);
    expect(blockExternalPresentationMedia(presentation)).toBeGreaterThanOrEqual(0);
  });

  it("blocks external resources across slides, layouts, and masters while retaining hyperlinks", () => {
    const slide = relationshipOwner();
    const layout = relationshipOwner();
    const master = relationshipOwner();
    const presentation = {
      layouts: new Map([["layout", layout]]),
      masters: new Map([["master", master]]),
      slides: [slide],
    };

    expect(blockExternalPresentationMedia(presentation as never)).toBe(6);
    for (const owner of [slide, layout, master]) {
      expect([...owner.rels.keys()]).toEqual(["embedded", "hyperlink"]);
    }
  });
});
