import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@baseblocks/anydoc-spreadsheet-engine": new URL(
        "../spreadsheet-engine/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
});
