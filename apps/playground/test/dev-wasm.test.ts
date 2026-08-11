import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";

let server: ViteDevServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("playground development server", () => {
  it("serves the parser runtime as WebAssembly instead of the HTML fallback", async () => {
    server = await createServer({
      configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();

    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Vite did not expose a local test port.");
    const origin = `http://127.0.0.1:${address.port}`;
    const platformPath = fileURLToPath(new URL("../../../packages/platform/browser.js", import.meta.url));

    const platformModule = await fetch(`${origin}/@fs${platformPath}`).then((response) => response.text());
    const runtimePath = platformModule.match(/import\("([^"]*@firecrawl[^"?]*anydoc-wasm[^"?]*\.js[^"?]*\?[^"?]+)"\)/)?.[1];
    expect(runtimePath, "Vite should expose the AnyDoc Wasm JavaScript module").toBeTruthy();

    const runtimeModule = await fetch(new URL(runtimePath!, origin)).then((response) => response.text());
    const wasmPath = runtimeModule.match(/new URL\("([^"]*anydoc_wasm_bg\.wasm)"/)?.[1];
    expect(wasmPath, "The runtime should reference its Wasm binary").toBeTruthy();

    const wasmResponse = await fetch(new URL(wasmPath!, origin));
    expect(wasmResponse.headers.get("content-type")).toContain("application/wasm");
    expect([...new Uint8Array(await wasmResponse.arrayBuffer()).slice(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });
});
