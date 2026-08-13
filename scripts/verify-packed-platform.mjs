import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { platformConsumerPackageDirectories } from "./viewer-packages.mjs";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "anydoc-platform-consumer-"));
const artifacts = join(temporary, "artifacts");
const consumer = join(temporary, "consumer");

try {
  await mkdir(artifacts, { recursive: true });
  await mkdir(consumer, { recursive: true });
  const tarballs = [];
  for (const directory of platformConsumerPackageDirectories) {
    const output = execFileSync("pnpm", ["--dir", join(root, directory), "pack", "--pack-destination", artifacts], { encoding: "utf8" }).trim();
    tarballs.push(resolve(output.split(/\r?\n/).at(-1)));
  }
  execFileSync("npm", ["install", "--before=2100-01-01", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", ...tarballs], { cwd: consumer, stdio: "inherit" });
  const browser = await import(join(consumer, "node_modules/@baseblocks/anydoc/browser.js"));
  const result = await browser.ingest(new TextEncoder().encode("packed browser"), { format: "text" });
  const viewer = await import(join(consumer, "node_modules/@baseblocks/anydoc/react.js"));
  if (result.markdown !== "packed browser" || typeof viewer.AnyDocumentViewer !== "function") {
    throw new Error("Packed umbrella browser/viewer smoke failed.");
  }
  console.log("PASS packed umbrella browser ingestion and universal viewer");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
