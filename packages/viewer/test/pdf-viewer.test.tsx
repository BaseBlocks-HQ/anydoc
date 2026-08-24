// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const pageRenderError = new Error("Bad (uncompressed) XRef entry: 3R");

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  TextLayer: class {
    cancel() {}
    async render() {}
  },
  getDocument: () => ({
    destroy: async () => {},
    promise: Promise.resolve({
      getPage: async (pageNumber: number) => ({
        cleanup: () => {},
        getViewport: ({ scale }: { scale: number }) => ({
          height: 100 * scale,
          width: 100 * scale,
        }),
        render: () => ({
          cancel: () => {},
          promise:
            pageNumber === 1
              ? Promise.reject(pageRenderError)
              : Promise.resolve(),
        }),
        streamTextContent: () => ({}),
      }),
      numPages: 2,
    }),
  }),
}));

import { PdfViewer } from "../src/react.js";

describe("PDF viewer page failures", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
      },
    );
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({})) as never;
  });

  it("isolates a corrupt page without replacing the complete document", async () => {
    const onError = vi.fn();
    render(
      <PdfViewer
        maxRenderedPages={2}
        onError={onError}
        source={new Uint8Array([37, 80, 68, 70])}
      />,
    );

    expect(
      await screen.findByText("Unable to render PDF page 1."),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "PDF page 2" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      cause: pageRenderError,
      code: "render-failed",
    });
  });
});
