import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("playground workspace layout", () => {
  it("uses one bounded pane size and keeps overflow inside each pane", () => {
    expect(styles).toContain("--workspace-pane-block-size: 590px");
    expect(styles).toContain("block-size: var(--workspace-pane-block-size)");
    expect(styles).toMatch(/\.workspace-pane\s*\{[^}]*overflow:\s*hidden/su);
    expect(styles).toMatch(/\.viewer-stage\s*\{[^}]*overflow:\s*hidden/su);
    expect(styles).toMatch(/\.output-stage\s*\{[^}]*overflow:\s*auto/su);
    expect(styles).not.toContain("min-height: 590px");
  });
});
