import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const crate = join(root, "spreadsheet-view");
const pkg = join(crate, "pkg");
const dist = join(root, "packages/viewer/dist/spreadsheet");

async function newestSourceTime(directory) {
  let newest = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "pkg" || entry.name === "target") continue;
    const info = await stat(path);
    const time = entry.isDirectory() ? await newestSourceTime(path) : info.mtimeMs;
    newest = Math.max(newest, time);
  }
  return newest;
}

let artifactTime = 0;
try {
  artifactTime = (await stat(join(pkg, "spreadsheet_view_bg.wasm"))).mtimeMs;
} catch {
  // Rebuilt below.
}

if ((await newestSourceTime(crate)) > artifactTime) {
  console.log("Building the spreadsheet Wasm engine (wasm-pack)…");
  execFileSync("wasm-pack", ["build", crate, "--release", "--target", "web"], {
    stdio: "inherit",
    cwd: root,
  });
}

await mkdir(dist, { recursive: true });
for (const name of ["spreadsheet_view.js", "spreadsheet_view_bg.wasm"]) {
  await copyFile(join(pkg, name), join(dist, name));
}
console.log(`Spreadsheet Wasm assets copied to ${dist}`);
