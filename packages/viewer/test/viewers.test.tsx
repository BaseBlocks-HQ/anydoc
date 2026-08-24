// @vitest-environment jsdom
import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownViewer, TextViewer } from "../src/react.js";

const bytes = (value: string) => new TextEncoder().encode(value);

// Lazy viewer chunks resolve through the React scheduler's setImmediate
// queue; drain pending work while the jsdom environment still exists so no
// callback fires after teardown.
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

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
