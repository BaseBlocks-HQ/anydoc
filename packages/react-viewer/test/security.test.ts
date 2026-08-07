import { describe, expect, it } from "vitest";
import { highlightText, sanitizeDocxDom } from "../src/security";

describe("DOCX DOM safety", () => {
  it("blocks active content, handlers, and external resource loads before attachment", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <script>bad()</script>
      <img src="https://tracker.test/pixel" onerror="bad()">
      <a href="javascript:bad()">unsafe</a>
      <a href="https://example.test/page">safe</a>
      <p style="background:url(https://tracker.test/a.png)">Hello</p>
      <style>@import "https://tracker.test/a.css"; .x { background: url(data:image/png;base64,AA==) }</style>
    `;
    sanitizeDocxDom(root);
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(root.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(root.querySelectorAll("a")[0]?.hasAttribute("href")).toBe(false);
    expect(root.querySelectorAll("a")[1]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(root.querySelector("p")?.getAttribute("style")).not.toContain("tracker.test");
    expect(root.querySelector("style")?.textContent).not.toContain("@import");
  });

  it("highlights text without interpreting it as HTML", () => {
    const root = document.createElement("div");
    root.textContent = "<img src=x> hello hello";
    expect(highlightText(root, "hello")).toHaveLength(2);
    expect(root.querySelector("img")).toBeNull();
  });
});
