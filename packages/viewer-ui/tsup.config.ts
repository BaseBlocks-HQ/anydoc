import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.tsx"],
  external: ["react", "react-dom", "react/jsx-runtime"],
  format: ["esm"],
  noExternal: ["@pierre/icons"],
  outExtension: () => ({ js: ".js" }),
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
