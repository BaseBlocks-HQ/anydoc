import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "anydoc-server-closure-"));
const artifacts = join(temporary, "artifacts");
const consumer = join(temporary, "consumer");

try {
  await mkdir(artifacts, { recursive: true });
  await mkdir(consumer, { recursive: true });
  const tarballs = [];
  for (const directory of ["packages/contracts", "packages/ingestion", "packages/convex"]) {
    const output = execFileSync("pnpm", ["--dir", join(root, directory), "pack", "--pack-destination", artifacts], { encoding: "utf8" }).trim();
    tarballs.push(resolve(output.split(/\r?\n/).at(-1)));
  }
  execFileSync("npm", ["install", "--before=2100-01-01", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", ...tarballs], { cwd: consumer, stdio: "inherit" });

  const forbidden = /(?:react|viewer|spreadsheet|presentation)/i;
  const visited = new Set();
  let bytes = 0;
  async function directoryBytes(directory) {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) total += await directoryBytes(path);
      else if (entry.isFile()) total += (await stat(path)).size;
    }
    return total;
  }
  async function visit(name, fromDirectory) {
    const manifestPath = join(fromDirectory, "node_modules", name, "package.json");
    let canonical;
    try { canonical = await realpath(manifestPath); } catch { return; }
    if (visited.has(canonical)) return;
    visited.add(canonical);
    const manifest = JSON.parse(await readFile(canonical, "utf8"));
    if (forbidden.test(manifest.name)) throw new Error(`Server closure contains forbidden UI package: ${manifest.name}`);
    const packageDirectory = dirname(canonical);
    bytes += await directoryBytes(packageDirectory);
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      await visit(dependency, packageDirectory);
      await visit(dependency, consumer);
    }
  }
  await visit("@baseblocks/anydoc-convex", consumer);
  const maxBytes = 30 * 1024 * 1024;
  if (bytes > maxBytes) throw new Error(`Server dependency closure is ${(bytes / 1024 / 1024).toFixed(2)} MiB; budget is 30 MiB.`);

  const ingestion = await import(join(consumer, "node_modules/@baseblocks/anydoc-ingestion/node.js"));
  const sources = await import(join(consumer, "node_modules/@baseblocks/anydoc-ingestion/src/sources.js"));
  const convex = await import(join(consumer, "node_modules/@baseblocks/anydoc-convex/dist/node.js"));
  if (typeof ingestion.ingest !== "function" || typeof sources.iterableSource !== "function" || typeof convex.createConvexIngestionHandler !== "function" || typeof convex.iterableSource !== "function") {
    throw new Error("Packed server consumer is missing a required public API.");
  }
  console.log(`PASS packed Convex server closure: ${(bytes / 1024 / 1024).toFixed(2)} MiB; no UI packages`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
