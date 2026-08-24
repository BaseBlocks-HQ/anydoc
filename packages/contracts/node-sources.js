import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentPlatformError } from "./index.js";

export function fileSource(path, metadata = {}) {
  const filename = resolve(path instanceof URL ? fileURLToPath(path) : path);
  return Object.freeze({
    id: metadata.id ?? filename,
    async open({ signal } = {}) {
      let before;
      try {
        before = await stat(filename, { bigint: true });
      } catch (cause) {
        throw new DocumentPlatformError("The document file could not be inspected.", { code: "fetch-failed", cause });
      }
      if (!before.isFile()) {
        throw new DocumentPlatformError("The document path is not a regular file.", { code: "invalid-source" });
      }
      const stream = createReadStream(filename, { signal });
      return {
        stream,
        size: Number(before.size),
        filename: metadata.filename ?? filename.split(/[\\/]/).at(-1),
        contentType: metadata.contentType,
        etag: metadata.etag,
        async close() {
          stream.destroy();
          const after = await stat(filename, { bigint: true }).catch(() => null);
          if (!after || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ino !== before.ino) {
            throw new DocumentPlatformError("The document file changed while it was being read.", { code: "source-changed" });
          }
        },
      };
    },
  });
}
