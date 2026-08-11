import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/anydoc/" : "/",
  optimizeDeps: {
    exclude: ["@firecrawl/anydoc-wasm"],
  },
  plugins: [react()],
});
