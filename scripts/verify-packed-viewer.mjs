import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { publicViewerPackageDirectories } from "./viewer-packages.mjs";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "anydoc-viewer-consumer-"));
const artifacts = join(temporary, "artifacts");
const consumer = join(temporary, "consumer");

try {
  await mkdir(artifacts, { recursive: true });
  await mkdir(consumer, { recursive: true });
  const tarballs = [];
  for (const directory of publicViewerPackageDirectories) {
    const output = execFileSync("pnpm", ["--dir", join(root, directory), "pack", "--pack-destination", artifacts], { encoding: "utf8" }).trim();
    tarballs.push(resolve(output.split(/\r?\n/).at(-1)));
  }
  execFileSync("npm", ["install", "--before=2100-01-01", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", ...tarballs, "react@19", "react-dom@19"], { cwd: consumer, stdio: "inherit" });
  // Both entries must import under strict Node ESM.
  const headless = await import(join(consumer, "node_modules/@baseblocks/anydoc-viewer/dist/index.js"));
  const reactEntry = await import(join(consumer, "node_modules/@baseblocks/anydoc-viewer/dist/react.js"));
  if (
    typeof headless.detectViewerFormatFromBytes !== "function"
    || typeof headless.loadDocumentBytes !== "function"
    || typeof reactEntry.AnyDocumentViewer !== "function"
    || typeof reactEntry.SpreadsheetViewer !== "function"
    || typeof reactEntry.PresentationViewer !== "function"
    || typeof reactEntry.ViewerToolbar !== "function"
  ) {
    throw new Error("Packed viewer consumer is missing a required public API.");
  }
  console.log("PASS packed viewer headless and React entries");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
