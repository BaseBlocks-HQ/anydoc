import { build } from "esbuild";
import { rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "packages/viewer/dist/spreadsheet");

async function bundle(entryPoint, outputFile) {
  const temporaryOutput = `${outputFile}.tmp`;
  await rm(temporaryOutput, { force: true });
  await build({
    bundle: true,
    entryPoints: [entryPoint],
    format: "esm",
    logLevel: "warning",
    outfile: temporaryOutput,
    platform: "browser",
    target: "es2022",
  });
  await rename(temporaryOutput, outputFile);
}

await bundle(
  join(dist, "spreadsheet-engine.js"),
  join(dist, "spreadsheet-engine.js"),
);
await bundle(
  join(dist, "spreadsheet-worker.js"),
  join(dist, "spreadsheet-worker.js"),
);
