// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownViewer, TextViewer } from "../src/react.js";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("React viewers", () => {
  it("exposes live state to custom controls", async () => {
    render(
      <TextViewer
        source={bytes("one\ntwo")}
        title="notes.txt"
        controls={{
          render: (controls) => <output data-testid="controls">{controls.format}:{controls.status}:{controls.title}</output>,
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("controls")).toHaveTextContent("text:ready:notes.txt"));
  });

  it("can hide all built-in controls for a headless surface", async () => {
    render(<TextViewer controls={false} source={bytes("plain text")} />);
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
  });

  it("sanitizes raw Markdown HTML and blocks remote images by default", async () => {
    const { container } = render(
      <MarkdownViewer source={bytes("# Safe\n<script>bad()</script>\n<img src='https://tracker.test/pixel' onerror='bad()' alt='secret'>")} />,
    );
    expect(await screen.findByRole("heading", { name: "Safe" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "secret" })).toHaveTextContent("secret");
  });
});
