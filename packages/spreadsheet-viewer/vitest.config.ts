import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@baseblocks/anydoc-spreadsheet-engine": fileURLToPath(
        new URL("../spreadsheet-engine/src/index.ts", import.meta.url),
      ),
    },
  },
});
