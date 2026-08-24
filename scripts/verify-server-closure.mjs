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
  const output = execFileSync("pnpm", ["--dir", join(root, "packages/contracts"), "pack", "--pack-destination", artifacts], { encoding: "utf8" }).trim();
  const tarball = resolve(output.split(/\r?\n/).at(-1));
  execFileSync("npm", ["install", "--before=2100-01-01", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], { cwd: consumer, stdio: "inherit" });

  const forbidden = /(?:react|viewer|spreadsheet|presentation|ingestion|convex)/i;
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
    if (forbidden.test(manifest.name)) throw new Error(`Server closure contains forbidden package: ${manifest.name}`);
    const packageDirectory = dirname(canonical);
    bytes += await directoryBytes(packageDirectory);
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
      await visit(dependency, packageDirectory);
      await visit(dependency, consumer);
    }
  }
  await visit("@baseblocks/anydoc-contracts", consumer);
  const maxBytes = 1 * 1024 * 1024;
  if (bytes > maxBytes) throw new Error(`Server dependency closure is ${(bytes / 1024).toFixed(0)} KiB; budget is 1 MiB.`);

  const contracts = await import(join(consumer, "node_modules/@baseblocks/anydoc-contracts/index.js"));
  const sources = await import(join(consumer, "node_modules/@baseblocks/anydoc-contracts/sources.js"));
  if (
    typeof contracts.isSafeExternalUrl !== "function"
    || typeof sources.iterableSource !== "function"
    || typeof sources.readSource !== "function"
    || typeof sources.bytesSource !== "function"
  ) {
    throw new Error("Packed server consumer is missing a required public API.");
  }
  console.log(`PASS packed contracts server closure: ${(bytes / 1024).toFixed(0)} KiB; no UI packages`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
