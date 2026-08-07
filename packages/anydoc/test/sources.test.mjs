import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { fileSource } from "../src/node-sources.js";
import { bytesSource, createSha256, iterableSource, readSource, webSource } from "../src/sources.js";

const encoder = new TextEncoder();
const helloChecksum = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

test("incremental SHA-256 matches a standard vector across chunk boundaries", () => {
  const checksum = createSha256();
  checksum.update(encoder.encode("he"));
  checksum.update(encoder.encode("llo"));
  assert.equal(checksum.digestHex(), helloChecksum);
});

test("Node file sources stream regular files and accept file URLs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "anydoc-source-"));
  const path = join(directory, "document.txt");
  try {
    await writeFile(path, "hello");
    const result = await readSource(fileSource(pathToFileURL(path)), { expectedSize: 5, expectedSha256: helloChecksum });
    assert.equal(result.filename, "document.txt");
    assert.equal(new TextDecoder().decode(result.bytes), "hello");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("bounded reads verify checksum and materialize a known-size source once", async () => {
  const progress = [];
  const result = await readSource(bytesSource(encoder.encode("hello")), {
    expectedSize: 5,
    expectedSha256: helloChecksum,
    maxBytes: 5,
    onProgress: (value) => progress.push(value.bytesRead),
  });
  assert.equal(new TextDecoder().decode(result.bytes), "hello");
  assert.equal(result.sha256, helloChecksum);
  assert.deepEqual(progress, [5]);
});

test("declared-size early EOF and overrun are rejected and the source is closed", async () => {
  let closes = 0;
  const short = { async open() { return { stream: (async function* () { yield encoder.encode("hi"); })(), size: 3, close: () => { closes += 1; } }; } };
  await assert.rejects(readSource(short), { code: "source-changed", retryable: false });

  const long = { async open() { return { stream: (async function* () { yield encoder.encode("toolong"); })(), size: 3, close: () => { closes += 1; } }; } };
  await assert.rejects(readSource(long), { code: "source-changed", retryable: false });
  assert.equal(closes, 2);
});

test("checksum mismatches and byte ceilings have stable terminal errors", async () => {
  await assert.rejects(readSource(bytesSource(encoder.encode("hello")), { expectedSha256: "0".repeat(64) }), {
    code: "integrity-failed",
    retryable: false,
  });
  await assert.rejects(readSource(bytesSource(encoder.encode("hello")), { maxBytes: 4 }), {
    code: "too-large",
    retryable: false,
  });
});

test("preflight size rejection still closes an opened transport", async () => {
  let closed = false;
  const source = {
    async open() {
      return { stream: (async function* () {})(), size: 10, close() { closed = true; } };
    },
  };
  await assert.rejects(readSource(source, { maxBytes: 9 }), { code: "too-large" });
  assert.equal(closed, true);
});

test("abort stops an active stream and close errors never mask the read failure", async () => {
  const controller = new AbortController();
  const source = iterableSource(async function* () {
    yield encoder.encode("a");
    controller.abort("stop");
    yield encoder.encode("b");
  });
  await assert.rejects(readSource(source, { signal: controller.signal }), { code: "aborted" });

  const failing = {
    async open() {
      return {
        stream: (async function* () { throw new Error("primary"); })(),
        close() { throw new Error("secondary"); },
      };
    },
  };
  await assert.rejects(readSource(failing), (cause) => cause.code === "fetch-failed" && cause.cause?.message === "primary");
});

test("deadline expiry is retryable and closes the active source", async () => {
  let closed = false;
  const source = {
    async open() {
      return {
        stream: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield encoder.encode("late");
        })(),
        close() { closed = true; },
      };
    },
  };
  await assert.rejects(readSource(source, { deadline: Date.now() + 1 }), { code: "deadline-exceeded", retryable: true });
  assert.equal(closed, true);
});

test("server web sources require SSRF policy and strip credentials across origins", async () => {
  assert.throws(() => webSource("https://files.example/document"), { code: "invalid-source" });
  const requests = [];
  const source = webSource("https://files.example/document", {
    allowUrl: () => true,
    request: { credentials: "include", headers: { authorization: "Bearer secret", cookie: "token=secret", "x-safe": "yes" } },
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) return new Response(null, { status: 302, headers: { location: "https://cdn.example/document" } });
      return new Response(encoder.encode("hello"), { status: 200, headers: { "content-length": "5" } });
    },
  });
  await readSource(source);
  assert.equal(requests[1].init.credentials, "omit");
  assert.equal(requests[1].init.headers.get("authorization"), null);
  assert.equal(requests[1].init.headers.get("cookie"), null);
  assert.equal(requests[1].init.headers.get("x-safe"), "yes");
});
