# Viewer package publishing

The nine public `@baseblocks/anydoc-*` npm packages are versioned together with
Changesets v3. They remain independent from the Rust, native Node, WASM, and
Python `@firecrawl/anydoc` release family.

## Day-to-day changes

Add a patch changeset with every public viewer-package change:

```sh
pnpm changeset
```

Commit the generated `.changeset/*.md` file with the implementation. Changes
that do not affect a published package can carry an explicit empty changeset:

```sh
pnpm changeset --empty
```

CI runs `changeset status --since main` so a changed viewer package cannot be
merged without recorded release intent. Changesets keeps all nine packages in
one fixed group and updates their internal `workspace:` dependency ranges.

## Version PR

When a viewer release is ready, create a branch from `main`, apply the accumulated
changesets, and open a dedicated version PR:

```sh
git switch -c changeset-release/viewers
pnpm version:viewers
git add .
git commit -m "Version Any Doc viewer packages"
```

The command consumes accumulated changesets and advances the shared alpha
version, for example from `0.1.0-alpha.13` to `0.1.0-alpha.14`.

Review the package versions and dependency ranges before merging that PR.

## Publish

Publication remains an explicit, tag-gated operation so the existing build,
test, package, checksum, and registry-integrity checks stay authoritative:

```sh
git tag viewer-v0.1.0-alpha.14
git push origin viewer-v0.1.0-alpha.14
```

The `Publish viewer platform` workflow verifies that every package manifest
matches the tag, uploads the exact verified tarballs, publishes only missing
packages, verifies any already-published artifacts, and creates the GitHub
release. Alpha versions publish under the npm `next` dist-tag.

Do not use Changesets to version the `@firecrawl/anydoc` binding packages. Their
cross-language `v*` workflow and version gate remain separate.
