import { readdir, stat } from "node:fs/promises";

const budgets = [
  ["packages/viewer/dist/pdf.worker.min.mjs", 1_300_000],
  ["apps/playground/dist/assets/anydoc_wasm_bg-", 7_000_000],
];

let failed = false;
for (const [file, maximumBytes] of budgets) {
  let resolvedFile = file;
  if (file.endsWith("-")) {
    const slash = file.lastIndexOf("/");
    const directory = file.slice(0, slash);
    const prefix = file.slice(slash + 1);
    const match = (await readdir(directory)).find(
      (entry) => entry.startsWith(prefix) && (entry.endsWith(".js") || entry.endsWith(".wasm")),
    );
    if (!match) throw new Error(`Missing built asset matching ${file}*`);
    resolvedFile = `${directory}/${match}`;
  }
  const { size } = await stat(resolvedFile);
  const status = size <= maximumBytes ? "PASS" : "FAIL";
  console.log(`${status} ${resolvedFile}: ${size} / ${maximumBytes} bytes`);
  failed ||= size > maximumBytes;
}

async function directoryGraphSize(directory) {
  let size = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) size += await directoryGraphSize(path);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      size += (await stat(path)).size;
    }
  }
  return size;
}

for (const [directory, maximumBytes] of [
  ["packages/viewer/dist/spreadsheet", 1_200_000],
  ["apps/playground/dist/assets", 4_200_000],
]) {
  const size = await directoryGraphSize(directory);
  const status = size <= maximumBytes ? "PASS" : "FAIL";
  console.log(`${status} ${directory} JavaScript graph: ${size} / ${maximumBytes} bytes`);
  failed ||= size > maximumBytes;
}

if (failed) process.exitCode = 1;
