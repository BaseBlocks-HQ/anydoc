import {
  DocumentPlatformError,
  defaultDocumentLimits,
} from "@baseblocks/anydoc-contracts";

function sourceError(message, code, cause, status, retryable = false) {
  return new DocumentPlatformError(message, { code, cause, status, retryable });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    if (signal.reason instanceof DocumentPlatformError) throw signal.reason;
    throw sourceError("The document read was aborted.", "aborted", signal.reason);
  }
}

async function waitWithSignal(promise, signal) {
  const task = Promise.resolve(promise);
  try { throwIfAborted(signal); } catch (cause) {
    void task.catch(() => undefined);
    throw cause;
  }
  if (!signal) return task;
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      try { throwIfAborted(signal); } catch (cause) { reject(cause); }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([task, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function asChunk(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw sourceError("A document source yielded a non-binary chunk.", "invalid-source");
}

async function* iterateStream(stream, signal) {
  if (stream && typeof stream[Symbol.asyncIterator] === "function") {
    const iterator = stream[Symbol.asyncIterator]();
    let completed = false;
    try {
      while (true) {
        const step = await waitWithSignal(Promise.resolve().then(() => iterator.next()), signal);
        if (step.done) { completed = true; return; }
        yield asChunk(step.value);
      }
    } finally {
      if (!completed && typeof iterator.return === "function") {
        const cleanup = Promise.resolve().then(() => iterator.return());
        void cleanup.catch(() => undefined);
      }
    }
  }
  if (stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await waitWithSignal(reader.read(), signal);
        if (done) return;
        yield asChunk(value);
      }
    } finally {
      if (signal?.aborted) {
        void reader.cancel(signal.reason).catch(() => undefined).finally(() => {
          try { reader.releaseLock(); } catch { /* cancellation still owns the pending read */ }
        });
      } else {
        reader.releaseLock();
      }
    }
  } else {
    throw sourceError("A document source must expose an async iterable or ReadableStream.", "invalid-source");
  }
}

function normalizeSha256(value) {
  if (value === undefined) return undefined;
  const normalized = String(value).toLowerCase().replace(/^sha256:/, "");
  if (!/^[a-f\d]{64}$/.test(normalized)) {
    throw sourceError("The expected SHA-256 checksum must be 64 hexadecimal characters.", "invalid-source");
  }
  return normalized;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value, count) => (value >>> count) | (value << (32 - count));

export function createSha256() {
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const block = new Uint8Array(64);
  const words = new Uint32Array(64);
  let blockLength = 0;
  let bytesHashed = 0;
  let finished = false;

  const compress = () => {
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      words[index] = ((block[offset] << 24) | (block[offset + 1] << 16) | (block[offset + 2] << 8) | block[offset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  };

  const update = (input) => {
    if (finished) throw sourceError("A finalized checksum cannot be updated.", "invalid-source");
    const bytes = asChunk(input);
    bytesHashed += bytes.byteLength;
    if (!Number.isSafeInteger(bytesHashed)) throw sourceError("The checksum input is too large.", "too-large");
    let offset = 0;
    while (offset < bytes.byteLength) {
      const length = Math.min(64 - blockLength, bytes.byteLength - offset);
      block.set(bytes.subarray(offset, offset + length), blockLength);
      blockLength += length;
      offset += length;
      if (blockLength === 64) { compress(); blockLength = 0; }
    }
  };

  const digestHex = () => {
    if (finished) throw sourceError("A checksum can only be finalized once.", "invalid-source");
    finished = true;
    block[blockLength++] = 0x80;
    if (blockLength > 56) { block.fill(0, blockLength); compress(); blockLength = 0; }
    block.fill(0, blockLength, 56);
    // Encode the 64-bit bit length without first multiplying the complete
    // safe-integer byte count beyond JavaScript's exact integer range.
    const high = Math.floor(bytesHashed / 0x2000_0000);
    const low = (bytesHashed * 8) >>> 0;
    for (let index = 0; index < 4; index += 1) {
      block[59 - index] = (high >>> (index * 8)) & 0xff;
      block[63 - index] = (low >>> (index * 8)) & 0xff;
    }
    compress();
    return [...state].map((value) => value.toString(16).padStart(8, "0")).join("");
  };
  return Object.freeze({ update, digestHex });
}

export async function sha256Hex(bytes) {
  const checksum = createSha256();
  checksum.update(bytes);
  return checksum.digestHex();
}

/**
 * Materialize an untrusted source with a hard byte ceiling and optional
 * length/checksum verification. The source is consumed once and always closed.
 */
export async function readSource(source, options = {}) {
  if (!source || typeof source.open !== "function") {
    throw sourceError("A document source must implement open().", "invalid-source");
  }
  const maximum = options.maxBytes ?? defaultDocumentLimits.maxBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw sourceError("maxBytes must be a non-negative safe integer.", "invalid-source");
  }
  const expectedSize = options.expectedSize;
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
    throw sourceError("expectedSize must be a non-negative safe integer.", "invalid-source");
  }
  if (expectedSize !== undefined && expectedSize > maximum) {
    throw sourceError(`Document exceeds the ${maximum.toLocaleString()} byte limit.`, "too-large");
  }
  const expectedSha256 = normalizeSha256(options.expectedSha256);
  const deadline = options.deadline instanceof Date ? options.deadline.getTime() : options.deadline;
  if (deadline !== undefined && !Number.isFinite(deadline)) {
    throw sourceError("deadline must be a valid date or Unix epoch millisecond value.", "invalid-source");
  }
  const deadlineController = deadline === undefined ? undefined : new AbortController();
  const deadlineFailure = () => sourceError("The document read exceeded its deadline.", "deadline-exceeded", undefined, undefined, true);
  let timeout;
  const armDeadline = () => {
    if (!deadlineController || deadlineController.signal.aborted) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) deadlineController.abort(deadlineFailure());
    else timeout = setTimeout(armDeadline, Math.min(remaining, 0x7fff_ffff));
  };
  armDeadline();
  const signal = deadlineController
    ? AbortSignal.any([...(options.signal ? [options.signal] : []), deadlineController.signal])
    : options.signal;
  const clearDeadline = () => { if (timeout !== undefined) clearTimeout(timeout); };
  try { throwIfAborted(signal); } catch (cause) { clearDeadline(); throw cause; }

  let opened;
  const opening = Promise.resolve().then(() => source.open({ signal }));
  try {
    opened = await waitWithSignal(opening, signal);
  } catch (cause) {
    if (signal?.aborted) {
      // A non-cooperative source may finish opening after cancellation. Close
      // that late resource without holding the caller past its deadline.
      void opening.then((late) => late?.close?.()).catch(() => undefined);
    }
    clearDeadline();
    if (deadlineController?.signal.aborted) throw deadlineController.signal.reason;
    if (cause instanceof DocumentPlatformError) throw cause;
    throw sourceError("The document source could not be opened.", "fetch-failed", cause, undefined, true);
  }
  if (!opened || !("stream" in opened)) {
    if (opened) {
      try { await waitWithSignal(Promise.resolve().then(() => opened.close?.()), signal); } catch { /* preserve the invalid-source error */ }
    }
    clearDeadline();
    throw sourceError("A document source returned no stream.", "invalid-source");
  }

  const rejectOpened = async (failure) => {
    try { await waitWithSignal(Promise.resolve().then(() => opened.close?.()), signal); } catch { /* preserve the validation failure */ }
    clearDeadline();
    throw failure;
  };

  const advertisedSize = opened.size;
  if (advertisedSize !== undefined && (!Number.isSafeInteger(advertisedSize) || advertisedSize < 0)) {
    return rejectOpened(sourceError("The document source reported an invalid size.", "invalid-source"));
  }
  if (advertisedSize !== undefined && advertisedSize > maximum) {
    return rejectOpened(sourceError(`Document exceeds the ${maximum.toLocaleString()} byte limit.`, "too-large"));
  }
  if (expectedSize !== undefined && advertisedSize !== undefined && expectedSize !== advertisedSize) {
    return rejectOpened(sourceError("The document source size changed before it was read.", "source-changed"));
  }

  const chunks = [];
  const knownSize = expectedSize ?? advertisedSize;
  const bytes = knownSize === undefined ? undefined : new Uint8Array(knownSize);
  const checksum = expectedSha256 || options.calculateSha256
    ? options.createChecksum?.() ?? (options.sha256 ? undefined : createSha256())
    : undefined;
  let byteLength = 0;
  let readFailure;
  let result;
  try {
    for await (const chunk of iterateStream(opened.stream, signal)) {
      if (chunk.byteLength === 0) continue;
      if (byteLength > maximum - chunk.byteLength) {
        throw sourceError(`Document exceeds the ${maximum.toLocaleString()} byte limit.`, "too-large");
      }
      if (knownSize !== undefined && byteLength > knownSize - chunk.byteLength) {
        throw sourceError("The document source exceeded its declared or expected size.", "source-changed");
      }
      checksum?.update(chunk);
      if (bytes) bytes.set(chunk, byteLength);
      else chunks.push(chunk.slice());
      byteLength += chunk.byteLength;
      try { options.onProgress?.({ bytesRead: byteLength, totalBytes: advertisedSize }); } catch { /* telemetry is best-effort */ }
    }

    if (advertisedSize !== undefined && byteLength !== advertisedSize) {
      throw sourceError("The document source ended at a different size than advertised.", "source-changed");
    }
    if (expectedSize !== undefined && byteLength !== expectedSize) {
      throw sourceError("The document source size does not match the expected size.", "source-changed");
    }

    let resultBytes = bytes;
    if (!resultBytes) {
      resultBytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        resultBytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    let checksumValue;
    try {
      checksumValue = checksum
        ? checksum.digestHex()
        : options.sha256 && (expectedSha256 || options.calculateSha256)
          ? await options.sha256(resultBytes)
          : undefined;
    } catch (cause) {
      throw sourceError("The document checksum could not be calculated.", "integrity-failed", cause);
    }
    if (expectedSha256 && checksumValue?.toLowerCase() !== expectedSha256) {
      throw sourceError("The document source failed SHA-256 verification.", "integrity-failed");
    }
    result = Object.freeze({
      bytes: resultBytes,
      byteLength,
      sha256: checksumValue,
      contentType: opened.contentType,
      filename: opened.filename,
      etag: opened.etag,
    });
  } catch (cause) {
    readFailure = cause instanceof DocumentPlatformError
      ? cause
      : signal?.aborted
        ? deadlineController?.signal.aborted
          ? deadlineController.signal.reason
          : sourceError("The document read was aborted.", "aborted", options.signal?.reason)
        : sourceError("The document source failed while streaming.", "fetch-failed", cause, undefined, true);
  } finally {
    try {
      await waitWithSignal(Promise.resolve().then(() => opened.close?.()), signal);
    } catch (cause) {
      if (!readFailure) {
        throw cause instanceof DocumentPlatformError
          ? cause
          : sourceError("The document source failed while closing.", "fetch-failed", cause, undefined, true);
      }
    } finally {
      clearDeadline();
    }
  }
  if (readFailure) throw readFailure;
  return result;
}

export function bytesSource(input, metadata = {}) {
  const stored = asChunk(input).slice();
  return Object.freeze({
    id: metadata.id,
    async open() {
      return {
        stream: (async function* () { yield stored; })(),
        size: stored.byteLength,
        contentType: metadata.contentType,
        filename: metadata.filename,
        etag: metadata.etag,
      };
    },
  });
}

export function iterableSource(factory, metadata = {}) {
  if (typeof factory !== "function") throw sourceError("An iterable source requires a stream factory.", "invalid-source");
  return Object.freeze({
    id: metadata.id,
    async open(context) {
      return {
        stream: await factory(context),
        size: metadata.size,
        contentType: metadata.contentType,
        filename: metadata.filename,
        etag: metadata.etag,
      };
    },
  });
}

function isFetchUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function webSource(url, options = {}) {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw sourceError("fetch is unavailable in this runtime.", "unsupported-runtime");
  }
  const serverRuntime = typeof globalThis.process === "object" && Boolean(globalThis.process?.versions?.node);
  if (serverRuntime && options.allowUrl === undefined) {
    throw sourceError("Server-side web sources require an explicit allowUrl policy to prevent SSRF.", "invalid-source");
  }
  const allowUrl = options.allowUrl ?? isFetchUrl;
  const maxRedirects = options.maxRedirects ?? 3;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10) {
    throw sourceError("maxRedirects must be an integer between 0 and 10.", "invalid-source");
  }
  return Object.freeze({
    id: options.id ?? String(url),
    async open({ signal } = {}) {
      let current = String(url);
      let request = { ...options.request };
      for (let redirect = 0; ; redirect += 1) {
        if (!isFetchUrl(current)) throw sourceError("The document URL must be HTTP(S) and cannot contain embedded credentials.", "invalid-source");
        if (!(await allowUrl(current))) throw sourceError("The document URL is not allowed by source policy.", "invalid-source");
        let response;
        try {
          response = await fetchImplementation(current, {
            ...request,
            body: undefined,
            method: "GET",
            redirect: "manual",
            signal,
          });
        } catch (cause) {
          if (signal?.aborted) throw sourceError("The document request was aborted.", "aborted", signal.reason);
          throw sourceError("The document request failed.", "fetch-failed", cause, undefined, true);
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirect >= maxRedirects) throw sourceError("The document source redirected too many times.", "fetch-failed", undefined, response.status);
          const location = response.headers.get("location");
          if (!location) throw sourceError("The document source returned a redirect without a location.", "fetch-failed", undefined, response.status);
          await response.body?.cancel();
          const next = new URL(location, current).href;
          if (!options.forwardCredentialsOnRedirect && new URL(next).origin !== new URL(current).origin) {
            // Caller-defined headers can carry credentials under arbitrary names
            // (for example X-API-Key), so a cross-origin hop drops all of them.
            request = { ...request, credentials: "omit", headers: new Headers(), referrer: undefined, referrerPolicy: "no-referrer" };
          }
          current = next;
          continue;
        }
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          throw sourceError("The document request returned an unsuccessful response.", "fetch-failed", undefined, response.status, retryable);
        }
        const lengthHeader = response.headers.get("content-length");
        const size = lengthHeader === null ? undefined : Number(lengthHeader);
        return {
          stream: response.body,
          size,
          contentType: response.headers.get("content-type") ?? undefined,
          filename: options.filename,
          etag: response.headers.get("etag") ?? undefined,
          close: () => response.body.cancel().catch(() => undefined),
        };
      }
    },
  });
}
