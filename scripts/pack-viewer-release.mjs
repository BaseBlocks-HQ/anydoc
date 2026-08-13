import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { publicViewerPackageDirectories } from "./viewer-packages.mjs";

const outputDirectory = resolve(process.argv[2] ?? "release-artifacts");
const expectedVersion = process.argv[3];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

await mkdir(outputDirectory, { recursive: true });
if ((await readdir(outputDirectory)).length > 0) {
  throw new Error(`Release output directory must be empty: ${outputDirectory}`);
}

const packages = [];
for (const directory of publicViewerPackageDirectories) {
  const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (expectedVersion && metadata.version !== expectedVersion) {
    throw new Error(`${directory} is ${metadata.version}; expected ${expectedVersion}.`);
  }
  const packedPath = run("pnpm", ["--dir", directory, "pack", "--pack-destination", outputDirectory]);
  packages.push({ name: metadata.name, version: metadata.version, tarball: basename(packedPath) });
}

await copyFile("scripts/verify-registry-package.mjs", join(outputDirectory, "verify-registry-package.mjs"));
await writeFile(join(outputDirectory, "packages.json"), `${JSON.stringify({ packages }, null, 2)}\n`);

const files = [...packages.map(({ tarball }) => tarball), "packages.json", "verify-registry-package.mjs"];
const checksums = [];
for (const file of files.sort()) {
  const digest = createHash("sha256").update(await readFile(join(outputDirectory, file))).digest("hex");
  checksums.push(`${digest}  ${file}`);
}
await writeFile(join(outputDirectory, "SHA256SUMS"), `${checksums.join("\n")}\n`);
