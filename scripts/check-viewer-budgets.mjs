import { readdir, stat } from "node:fs/promises";

const budgets = [
  ["packages/react-viewer/dist/index.js", 8_000],
  ["packages/react-viewer/dist/pdf-viewer-", 25_000],
  ["packages/react-viewer/dist/docx-viewer-", 15_000],
  ["packages/react-viewer/dist/markdown-viewer-", 15_000],
  ["packages/react-viewer/dist/text-viewer-", 10_000],
  ["packages/presentation-viewer/dist/index.js", 30_000],
  ["packages/spreadsheet-engine/dist/index.js", 100_000],
  ["packages/spreadsheet-viewer/dist/index.js", 75_000],
  ["packages/react-viewer/dist/pdf.worker.min.mjs", 1_300_000],
  ["examples/react-viewer/dist/assets/presentation-", 1_150_000],
  ["examples/react-viewer/dist/assets/spreadsheet-", 350_000],
];

let failed = false;
for (const [file, maximumBytes] of budgets) {
  let resolvedFile = file;
  if (file.endsWith("-")) {
    const slash = file.lastIndexOf("/");
    const directory = file.slice(0, slash);
    const prefix = file.slice(slash + 1);
    const match = (await readdir(directory)).find(
      (entry) => entry.startsWith(prefix) && entry.endsWith(".js"),
    );
    if (!match) throw new Error(`Missing built chunk matching ${file}*.js`);
    resolvedFile = `${directory}/${match}`;
  }
  const { size } = await stat(resolvedFile);
  const status = size <= maximumBytes ? "PASS" : "FAIL";
  console.log(`${status} ${resolvedFile}: ${size} / ${maximumBytes} bytes`);
  failed ||= size > maximumBytes;
}

for (const [directory, maximumBytes] of [
  ["packages/spreadsheet-engine/dist", 350_000],
  ["packages/spreadsheet-viewer/dist", 150_000],
]) {
  const entries = (await readdir(directory)).filter((entry) => entry.endsWith(".js"));
  let size = 0;
  for (const entry of entries) size += (await stat(`${directory}/${entry}`)).size;
  const status = size <= maximumBytes ? "PASS" : "FAIL";
  console.log(`${status} ${directory} JavaScript graph: ${size} / ${maximumBytes} bytes`);
  failed ||= size > maximumBytes;
}

if (failed) process.exitCode = 1;
