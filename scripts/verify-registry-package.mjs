import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const [directory, registrySpec] = process.argv.slice(2);
if (!directory || !registrySpec) {
  console.error("usage: node scripts/verify-registry-package.mjs <package-directory> <name@version>");
  process.exit(2);
}

const versionSeparator = registrySpec.lastIndexOf("@");
const packageName = registrySpec.slice(0, versionSeparator);
const packageVersion = registrySpec.slice(versionSeparator + 1);
if (!packageName || !packageVersion) throw new Error(`Invalid registry package specifier: ${registrySpec}`);

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `${command} exited with status ${result.status}: ${result.error?.message ?? "no output"}\n`);
    process.exit(result.status ?? 1);
  }
}

async function files(root, current = root, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) await files(root, path, result);
    else result.push(relative(root, path));
  }
  return result.sort();
}

async function manifest(root) {
  const result = new Map();
  for (const file of await files(root)) {
    const bytes = await readFile(join(root, file));
    result.set(file, createHash("sha256").update(bytes).digest("hex"));
  }
  return result;
}

const temporary = await mkdtemp(join(tmpdir(), "anydoc-package-verify-"));
try {
  const local = join(temporary, "local");
  const registry = join(temporary, "registry");
  const localExtracted = join(temporary, "local-extracted");
  const registryExtracted = join(temporary, "registry-extracted");
  await Promise.all([local, registry, localExtracted, registryExtracted].map((path) => mkdir(path)));
  run("pnpm", ["--dir", directory, "pack", "--pack-destination", local]);
  const metadataResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${packageVersion}`);
  if (!metadataResponse.ok) throw new Error(`npm metadata request for ${registrySpec} failed with ${metadataResponse.status}.`);
  const metadata = await metadataResponse.json();
  const tarballResponse = await fetch(metadata.dist.tarball);
  if (!tarballResponse.ok) throw new Error(`npm tarball request for ${registrySpec} failed with ${tarballResponse.status}.`);
  const registryBytes = new Uint8Array(await tarballResponse.arrayBuffer());
  const [algorithm, expectedDigest] = String(metadata.dist.integrity).split("-", 2);
  const actualDigest = createHash(algorithm).update(registryBytes).digest("base64");
  if (actualDigest !== expectedDigest) throw new Error(`npm integrity verification failed for ${registrySpec}.`);
  await writeFile(join(registry, "registry.tgz"), registryBytes);
  const [localTarball] = (await readdir(local)).filter((name) => name.endsWith(".tgz"));
  const [registryTarball] = (await readdir(registry)).filter((name) => name.endsWith(".tgz"));
  if (!localTarball || !registryTarball) throw new Error("Package packing did not produce both tarballs.");
  run("tar", ["-xzf", join(local, localTarball), "-C", localExtracted]);
  run("tar", ["-xzf", join(registry, registryTarball), "-C", registryExtracted]);
  const localManifest = await manifest(join(localExtracted, "package"));
  const registryManifest = await manifest(join(registryExtracted, "package"));
  const names = [...new Set([...localManifest.keys(), ...registryManifest.keys()])].sort();
  const differences = names.filter((name) => localManifest.get(name) !== registryManifest.get(name));
  if (differences.length > 0) {
    console.error(`${registrySpec} differs from the package built at this tag:`);
    for (const name of differences) console.error(`- ${name}`);
    process.exitCode = 1;
  } else {
    console.log(`${registrySpec} registry contents exactly match the package built at this tag (${names.length} files).`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
