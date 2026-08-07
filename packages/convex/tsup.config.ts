import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/node.ts"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  target: "es2022",
  treeshake: true,
  external: ["convex", "@convex-dev/workpool", "@baseblocks/anydoc/node"],
});
