import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicViewerPackageDirectories } from "./viewer-packages.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const changesetDir = resolve(rootDir, ".changeset");
const packages = publicViewerPackageDirectories.map((dir) => ({
  dir,
  manifest: JSON.parse(
    readFileSync(resolve(rootDir, dir, "package.json"), "utf8"),
  ),
}));
const packageNames = packages.map(({ manifest }) => manifest.name);
const violations = [];

function comparePackageSets(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const name of expectedSet) {
    if (!actualSet.has(name)) violations.push(`${label} is missing ${name}`);
  }
  for (const name of actualSet) {
    if (!expectedSet.has(name))
      violations.push(`${label} contains unexpected package ${name}`);
  }
  if (actualSet.size !== actual.length)
    violations.push(`${label} contains duplicate package names`);
}

for (const { dir, manifest } of packages) {
  if (manifest.private) violations.push(`${dir} must remain publishable`);
  if (!String(manifest.name).startsWith("@baseblocks/anydoc")) {
    violations.push(
      `${dir} has unexpected package name ${String(manifest.name)}`,
    );
  }
}

const versions = new Set(packages.map(({ manifest }) => manifest.version));
if (versions.size !== 1) {
  violations.push(
    `Viewer packages are not on one lockstep version: ${[...versions].join(", ")}`,
  );
}

const config = JSON.parse(
  readFileSync(resolve(changesetDir, "config.json"), "utf8"),
);
if (!Array.isArray(config.fixed) || config.fixed.length !== 1) {
  violations.push("Changesets must define exactly one fixed package group");
} else {
  comparePackageSets(config.fixed[0], packageNames, "Changesets fixed group");
}

const preState = JSON.parse(
  readFileSync(resolve(changesetDir, "pre.json"), "utf8"),
);
if (preState.mode !== "pre" || preState.tag !== "alpha") {
  violations.push(
    'Viewer packages must remain in the Changesets "alpha" prerelease channel',
  );
}

for (const file of readdirSync(changesetDir).filter(
  (name) => name.endsWith(".md") && name !== "README.md",
)) {
  const content = readFileSync(resolve(changesetDir, file), "utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!frontmatter) {
    violations.push(`${file}: missing valid changeset frontmatter`);
    continue;
  }

  for (const packageName of packageNames) {
    const release = frontmatter.match(
      new RegExp(
        `["']${packageName.replace("/", "\\/")}["']:\\s*(patch|minor|major)`,
        "i",
      ),
    );
    if (release && release[1].toLowerCase() !== "patch") {
      violations.push(
        `${file}: ${packageName} must use a patch release while in alpha`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Any Doc viewer release metadata is invalid.");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Any Doc viewer release metadata check passed.");
