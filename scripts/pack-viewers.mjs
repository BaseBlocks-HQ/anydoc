import { spawnSync } from "node:child_process";

const packages = [
  "packages/contracts",
  "packages/spreadsheet-engine",
  "packages/spreadsheet-viewer",
  "packages/presentation-viewer",
  "packages/react-viewer",
  "packages/anydoc",
  "packages/convex",
];
const dryRun = process.argv.includes("--dry-run");

for (const directory of packages) {
  const result = spawnSync(
    "pnpm",
    ["--dir", directory, "pack", ...(dryRun ? ["--dry-run"] : [])],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
