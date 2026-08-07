import { DocumentPlatformError } from "@baseblocks/anydoc-contracts";

const BINARY_TAG = "binary/base64";
const RESERVED_KEY = "$anydoc";
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function persistenceError(message, options, cause) {
  return new DocumentPlatformError(message, { code: options.code ?? "invalid-persistence", cause });
}

function normalizeLimits(options) {
  const limits = {
    maxBytes: options.maxBytes ?? Number.MAX_SAFE_INTEGER,
    maxTextBytes: options.maxTextBytes ?? Number.MAX_SAFE_INTEGER,
    maxBinaryBytes: options.maxBinaryBytes ?? Number.MAX_SAFE_INTEGER,
    maxEntries: options.maxEntries ?? 500_000,
    maxDepth: options.maxDepth ?? 128,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw persistenceError(`${name} must be a non-negative safe integer.`, options);
    }
  }
  return limits;
}

function asBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function encodeBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  const chunks = [];
  let chunk = "";
  for (let index = 0; index < bytes.byteLength; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    chunk += base64Alphabet[first >>> 2];
    chunk += base64Alphabet[((first & 3) << 4) | ((second ?? 0) >>> 4)];
    chunk += second === undefined ? "=" : base64Alphabet[((second & 15) << 2) | ((third ?? 0) >>> 6)];
    chunk += third === undefined ? "=" : base64Alphabet[third & 63];
    if (chunk.length >= 16_384) { chunks.push(chunk); chunk = ""; }
  }
  if (chunk) chunks.push(chunk);
  return chunks.join("");
}

function base64ByteLength(value, options) {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    throw persistenceError("Encoded binary data must contain canonical base64.", options);
  }
  let padding = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const valid = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (code === 61 && index >= value.length - 2) padding += 1;
    else if (!valid || padding > 0) throw persistenceError("Encoded binary data must contain canonical base64.", options);
  }
  if (padding > 2 || (padding === 1 && value.at(-2) === "=") || (padding === 2 && value.at(-3) === "=")) {
    throw persistenceError("Encoded binary data must contain canonical base64.", options);
  }
  if (padding === 2 && (base64Alphabet.indexOf(value.at(-3)) & 15) !== 0) {
    throw persistenceError("Encoded binary data must contain canonical base64.", options);
  }
  if (padding === 1 && (base64Alphabet.indexOf(value.at(-2)) & 3) !== 0) {
    throw persistenceError("Encoded binary data must contain canonical base64.", options);
  }
  return (value.length / 4) * 3 - padding;
}

function decodeBase64(value, options) {
  base64ByteLength(value, options);
  if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(value, "base64"));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function walkPersistenceValue(root, options, mode) {
  const limits = normalizeLimits(options);
  const ancestors = new WeakSet();
  const name = options.name ?? "The persistence value";
  let totalBytes = 0;
  let textBytes = 0;
  let binaryBytes = 0;
  let entries = 0;

  const invalid = (message, cause) => { throw persistenceError(`${name} ${message}`, options, cause); };
  const exceed = (message) => {
    throw new DocumentPlatformError(`${name} ${message}`, { code: "output-too-large" });
  };
  const addStructure = (bytes) => {
    if (bytes > limits.maxBytes - totalBytes) exceed(`exceeds the ${limits.maxBytes.toLocaleString()} byte budget.`);
    totalBytes += bytes;
  };
  const addText = (value) => {
    // UTF-16 length is a zero-allocation lower bound for UTF-8 bytes. Rejecting
    // it first avoids scanning or allocating for an already impossible string.
    if (value.length > limits.maxTextBytes - textBytes) exceed(`exceeds the ${limits.maxTextBytes.toLocaleString()} text-byte budget.`);
    if (value.length > limits.maxBytes - totalBytes) exceed(`exceeds the ${limits.maxBytes.toLocaleString()} byte budget.`);
    let bytes = value.length;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) continue;
      if (code <= 0x7ff) bytes += 1;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
        const low = value.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) { bytes += 2; index += 1; }
        else bytes += 2;
      } else bytes += 2;
      if (bytes > limits.maxTextBytes - textBytes) exceed(`exceeds the ${limits.maxTextBytes.toLocaleString()} text-byte budget.`);
      if (bytes > limits.maxBytes - totalBytes) exceed(`exceeds the ${limits.maxBytes.toLocaleString()} byte budget.`);
    }
    textBytes += bytes;
    totalBytes += bytes;
  };
  const enter = (value, depth) => {
    if (depth > limits.maxDepth) exceed(`exceeds the maximum nesting depth of ${limits.maxDepth}.`);
    entries += 1;
    if (entries > limits.maxEntries) exceed(`exceeds the ${limits.maxEntries.toLocaleString()} entry budget.`);

    if (value === null) { addStructure(4); return null; }
    if (typeof value === "string") { addText(value); return value; }
    if (typeof value === "boolean") { addStructure(value ? 4 : 5); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid("contains a non-finite number.");
      addStructure(8);
      return value;
    }
    if (typeof value !== "object") invalid(`contains unsupported ${typeof value} data.`);

    const bytes = asBytes(value);
    if (bytes) {
      if (mode === "canonical" || mode === "decode") invalid("contains raw binary instead of its encoded representation.");
      if (bytes.byteLength > limits.maxBinaryBytes - binaryBytes) exceed(`exceeds the ${limits.maxBinaryBytes.toLocaleString()} binary-byte budget.`);
      const encodedLength = Math.ceil(bytes.byteLength / 3) * 4;
      addStructure(encodedLength + 32);
      binaryBytes += bytes.byteLength;
      if (mode === "measure") return undefined;
      return { [RESERVED_KEY]: BINARY_TAG, data: encodeBase64(bytes) };
    }
    if (ancestors.has(value)) invalid("contains a cycle.");
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) invalid("contains symbol-keyed array data.");
      if (value.length > limits.maxEntries - entries) exceed(`exceeds the ${limits.maxEntries.toLocaleString()} entry budget.`);
      addStructure(value.length * 2 + 2);
      ancestors.add(value);
      const output = mode === "measure" ? undefined : new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) invalid("contains a sparse array.");
        const encoded = enter(value[index], depth + 1);
        if (output) output[index] = encoded;
      }
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key) invalid("contains custom array properties.");
      }
      ancestors.delete(value);
      return output;
    }
    if (!isPlainObject(value)) invalid(`contains unsupported ${value.constructor?.name ?? "object"} data.`);
    if (Object.getOwnPropertySymbols(value).length > 0) invalid("contains symbol-keyed data.");

    let markerPresent = false;
    let propertyCount = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      propertyCount += 1;
      if (key === RESERVED_KEY) markerPresent = true;
    }
    if (markerPresent) {
      const markerDescriptor = Object.getOwnPropertyDescriptor(value, RESERVED_KEY);
      const dataDescriptor = Object.getOwnPropertyDescriptor(value, "data");
      if (mode === "encode" || !markerDescriptor || !("value" in markerDescriptor) || markerDescriptor.value !== BINARY_TAG || !dataDescriptor || !("value" in dataDescriptor) || propertyCount !== 2 || typeof dataDescriptor.value !== "string") {
        invalid(`uses the reserved ${RESERVED_KEY} property.`);
      }
      const byteLength = base64ByteLength(dataDescriptor.value, options);
      if (byteLength > limits.maxBinaryBytes - binaryBytes) exceed(`exceeds the ${limits.maxBinaryBytes.toLocaleString()} binary-byte budget.`);
      addStructure(dataDescriptor.value.length + 32);
      binaryBytes += byteLength;
      if (mode === "decode") return decodeBase64(dataDescriptor.value, options);
      return mode === "measure" ? undefined : { [RESERVED_KEY]: BINARY_TAG, data: dataDescriptor.value };
    }

    ancestors.add(value);
    const output = mode === "measure" ? undefined : {};
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) invalid("contains an accessor property.");
      addText(key);
      const encoded = enter(descriptor.value, depth + 1);
      if (output) Object.defineProperty(output, key, { value: encoded, enumerable: true, configurable: true, writable: true });
    }
    ancestors.delete(value);
    addStructure(2);
    return output;
  };

  const value = enter(root, 0);
  return Object.freeze({ value, measurement: Object.freeze({ totalBytes, textBytes, binaryBytes, entries }) });
}

export function encodePersistenceValue(value, options = {}) {
  return walkPersistenceValue(value, options, "encode");
}

export function clonePersistenceValue(value, options = {}) {
  return walkPersistenceValue(value, options, "canonical").value;
}

export function decodePersistenceValue(value, options = {}) {
  return walkPersistenceValue(value, options, "decode").value;
}

export function measurePersistenceValue(value, options = {}) {
  return walkPersistenceValue(value, options, "measure").measurement;
}
