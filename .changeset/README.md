# Any Doc viewer releases

Changesets manages the eight public `@baseblocks/anydoc-*` npm packages as one
fixed, lockstep release. The workspace is in the `alpha` prerelease channel, so
each accepted patch changeset advances the shared `0.1.0-alpha.N` version.

- Run `pnpm changeset` in a feature branch and commit the generated Markdown file.
- Use a patch release type while the viewer platform remains in alpha.
- Use `pnpm changeset --empty` for changes that intentionally do not release packages.
- Open a `changeset-release/*` version PR with `pnpm version:viewers` when a release is ready.
- Publication remains gated by the verified `viewer-v*` tag workflow.

The Rust, Node native, WASM, and Python `@firecrawl/anydoc` release family is
intentionally outside this Changesets workspace and keeps its existing release process.
