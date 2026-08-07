import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.tsx"],
  format: ["esm"],
  minify: false,
  outDir: "dist",
  sourcemap: true,
  splitting: true,
  target: "es2022",
  treeshake: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
});
