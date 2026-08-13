import { spawnSync } from "node:child_process";
import { publicViewerPackageDirectories } from "./viewer-packages.mjs";

const dryRun = process.argv.includes("--dry-run");

for (const directory of publicViewerPackageDirectories) {
  const result = spawnSync(
    "pnpm",
    ["--dir", directory, "pack", ...(dryRun ? ["--dry-run"] : [])],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
