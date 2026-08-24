# AnyDoc contracts

Framework-neutral capability, structured-error, resource-limit, URL, and filename contracts shared across the AnyDoc stacks.

Subpaths:

- `@baseblocks/anydoc-contracts/sources` — `readSource`, `iterableSource`,
  `bytesSource`, `webSource`, and incremental SHA-256 helpers for materializing
  untrusted bytes under hard size, checksum, and deadline limits.
- `@baseblocks/anydoc-contracts/sources/node` — `fileSource` for streaming
  regular files under Node.
