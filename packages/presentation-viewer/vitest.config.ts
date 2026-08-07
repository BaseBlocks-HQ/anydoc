import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Keep React and the DOM renderer on one workspace instance even when a
    // package-local install exists (for example after consumer pack tests).
    alias: { react: resolve(import.meta.dirname, "../../node_modules/react") },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
