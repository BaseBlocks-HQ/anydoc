// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { AnyDocumentViewer } from "../src/universal-viewer.js";
import { detectViewerFormat, detectViewerFormatFromBytes } from "../src/detect.js";

vi.mock("../src/presentation/index.js", async () => {
  const { createElement } = await import("react");
  const { ViewerControlRegion } = await import("../src/controls.js");
  return {
    PresentationViewer: ({ controls, onControls }: { controls?: boolean | object; onControls?: (controls: object | null) => void }) => createElement(ViewerControlRegion, {
      controls: {
        actions: [{ id: "fullscreen", icon: "fullscreen", label: "Fullscreen", run: vi.fn() }],
        format: "pptx",
        pagination: { current: 1, goTo: vi.fn(), next: vi.fn(), previous: vi.fn(), total: 3 },
        search: { current: 0, next: vi.fn(), pending: false, previous: vi.fn(), query: "", setQuery: vi.fn(), total: 0 },
        status: "ready",
        zoom: { max: 4, min: 0.25, reset: vi.fn(), set: vi.fn(), step: 0.1, value: 1, zoomIn: vi.fn(), zoomOut: vi.fn() },
      },
      onControls,
      setting: controls ?? true,
    }),
  };
});

vi.mock("../src/spreadsheet/index.js", async () => {
  const { createElement } = await import("react");
  const { ViewerControlRegion } = await import("../src/controls.js");
  return {
    SpreadsheetViewer: ({ controls, onControls }: { controls?: boolean | object; onControls?: (controls: object | null) => void }) => createElement(ViewerControlRegion, {
      controls: {
        actions: [
          { id: "copy", icon: "copy", label: "Copy", run: vi.fn() },
          { id: "appearance", icon: "dark", label: "Use dark sheets", run: vi.fn() },
        ],
        details: {
          activeCell: { address: "A1", value: "hello" },
          appearance: "light",
          selectionStatistics: {},
        },
        format: "xlsx",
        search: { current: 0, next: vi.fn(), pending: false, previous: vi.fn(), query: "", setQuery: vi.fn(), total: 0 },
        status: "ready",
        zoom: { max: 4, min: 0.25, reset: vi.fn(), set: vi.fn(), step: 0.1, value: 1, zoomIn: vi.fn(), zoomOut: vi.fn() },
      },
      onControls,
      setting: controls ?? true,
    }),
  };
});

describe("detectViewerFormat", () => {
  it("uses explicit format, file metadata, and URLs without inspecting bytes in render", () => {
    expect(detectViewerFormat({ format: "csv", source: new Uint8Array() })).toBe("csv");
    expect(detectViewerFormat({ source: new File([], "report.xlsx") })).toBe("xlsx");
    expect(detectViewerFormat({ source: "https://example.test/deck.pptx?download=1" })).toBe("pptx");
    expect(detectViewerFormat({ source: new TextEncoder().encode("%PDF-1.7") })).toBeUndefined();
  });

  it("detects real OOXML and PDF signatures asynchronously", async () => {
    const [docx, xlsx, pptx] = await Promise.all([
      readFile("../../tests/fixtures/docx/text.docx"),
      readFile("../../tests/fixtures/xlsx/sheet.xlsx"),
      readFile("../../tests/fixtures/pptx/pres.pptx"),
    ]);
    await expect(detectViewerFormatFromBytes(docx)).resolves.toBe("docx");
    await expect(detectViewerFormatFromBytes(xlsx)).resolves.toBe("xlsx");
    await expect(detectViewerFormatFromBytes(pptx)).resolves.toBe("pptx");
    await expect(detectViewerFormatFromBytes(new TextEncoder().encode("%PDF-1.7"))).resolves.toBe("pdf");
  });

  it("does not guess signature-less text or CSV bytes", () => {
    expect(detectViewerFormat({ source: new TextEncoder().encode("a,b\n1,2") })).toBeUndefined();
  });
});

describe("AnyDocumentViewer", () => {
  it("normalizes presentation controls and can portal them", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    render(
      <AnyDocumentViewer
        controls={{ target }}
        format="pptx"
        source={new Uint8Array([1, 2, 3])}
      />,
    );

    await waitFor(() => expect(target.querySelector('[role="toolbar"]')).not.toBeNull());
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    target.remove();
  });

  it("normalizes spreadsheet actions and exposes headless controls", async () => {
    const onControls = vi.fn();
    render(
      <AnyDocumentViewer
        controls={false}
        format="xlsx"
        onControls={onControls}
        source={new Uint8Array([1, 2, 3])}
      />,
    );

    await waitFor(() => expect(onControls).toHaveBeenCalledWith(expect.objectContaining({ format: "xlsx" })));
    const controls = onControls.mock.calls.at(-1)?.[0];
    expect(controls.actions.map((action: { id: string }) => action.id)).toEqual(["copy", "appearance"]);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("clears controls on source changes and treats external abort as silent", async () => {
    const onControls = vi.fn();
    const onError = vi.fn();
    const controller = new AbortController();
    const view = render(
      <AnyDocumentViewer format="pptx" onControls={onControls} onError={onError} source={new Uint8Array([1])} />,
    );
    await waitFor(() => expect(onControls).toHaveBeenCalledWith(expect.objectContaining({ format: "pptx" })));

    controller.abort();
    view.rerender(
      <AnyDocumentViewer format="pptx" onControls={onControls} onError={onError} signal={controller.signal} source={new Uint8Array([2])} />,
    );
    await waitFor(() => expect(onControls).toHaveBeenLastCalledWith(null));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });
});
