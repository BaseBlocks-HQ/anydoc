import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
  const installedViewer = join(consumer, "node_modules/@baseblocks/anydoc-viewer/dist");
  const [workerSource, engineSource] = await Promise.all([
    readFile(join(installedViewer, "spreadsheet/spreadsheet-worker.js"), "utf8"),
    readFile(join(installedViewer, "spreadsheet/spreadsheet-engine.js"), "utf8"),
  ]);
  if (/\bfrom\s*["']\./.test(workerSource) || /\bimport\s*\(\s*["']\./.test(workerSource)) {
    throw new Error("Packed spreadsheet worker contains an unresolved relative import.");
  }
  if (!workerSource.includes("spreadsheet_view_bg.wasm") || !engineSource.includes("spreadsheet_view_bg.wasm")) {
    throw new Error("Packed spreadsheet engine does not retain its Wasm asset reference.");
  }
  await stat(join(installedViewer, "spreadsheet/spreadsheet_view_bg.wasm"));
  console.log("PASS packed viewer headless and React entries");
  console.log("PASS packed spreadsheet worker is self-contained and includes Wasm");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
