import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["react", "react/jsx-runtime", "@aiden0z/pptx-renderer"],
  format: ["esm"],
  outExtension: () => ({ js: ".js" }),
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
