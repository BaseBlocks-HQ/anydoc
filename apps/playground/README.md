# AnyDoc playground

The canonical demo for the BaseBlocks AnyDoc fork. It keeps the visual and
informational foundation of Firecrawl's original static Wasm demo while adding
the fork's embeddable document viewers.

Choose a sample or drop in a local document to see the two complementary
surfaces together:

- parser output as Markdown;
- a source-faithful preview for formats supported by the viewer packages.

Processing happens entirely in the browser. Files are not uploaded.

From the repository root:

```bash
pnpm install
pnpm dev:playground
```

Build, type-check, and test it with:

```bash
pnpm --dir apps/playground build
pnpm --dir apps/playground typecheck
pnpm --dir apps/playground test
```

GitHub Pages deploys `apps/playground/dist` through
[`../../.github/workflows/pages.yml`](../../.github/workflows/pages.yml).
