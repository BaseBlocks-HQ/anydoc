import type { OnCompleteArgs } from "@convex-dev/workpool";

const FAILURE_MARKER = "ANYDOC_FAILURE_V1:";
const MAX_FAILURE_MESSAGE_CHARACTERS = 2_048;
const MAX_FAILURE_FIELD_CHARACTERS = 128;
const LIMIT_KEYS = new Set([
  "actualBytes",
  "actualSize",
  "expectedSize",
  "limit",
  "maxBytes",
  "maxCells",
  "maxDocumentBytes",
  "maxPages",
  "maxSlides",
  "maxTextBytes",
  "maximum",
]);

export interface ConvexIngestionFailure {
  readonly version: 1;
  readonly kind: "anydoc-ingestion-failure";
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly format?: string;
  readonly status?: number;
  readonly limits?: Readonly<Record<string, number | string>>;
}

function field(cause: unknown, name: string): unknown {
  return cause && typeof cause === "object" && name in cause
    ? (cause as Record<string, unknown>)[name]
    : undefined;
}

function boundedString(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function collectLimits(cause: unknown): Record<string, number | string> | undefined {
  const limits: Record<string, number | string> = {};
  let current = cause;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    for (const key of LIMIT_KEYS) {
      const value = field(current, key);
      if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "string") {
        limits[key] ??= typeof value === "string"
          ? boundedString(value, MAX_FAILURE_FIELD_CHARACTERS)
          : value;
      }
    }
    current = field(current, "cause");
  }
  return Object.keys(limits).length === 0 ? undefined : limits;
}

/** Encodes a failure into the Workpool string channel without losing stable machine fields. */
export function encodeConvexIngestionFailure(cause: unknown): string {
  const code = field(cause, "code");
  const retryable = field(cause, "retryable");
  const format = field(cause, "format");
  const status = field(cause, "status");
  const limits = collectLimits(cause);
  const failure: ConvexIngestionFailure = {
    version: 1,
    kind: "anydoc-ingestion-failure",
    code: typeof code === "string" ? boundedString(code, MAX_FAILURE_FIELD_CHARACTERS) : "processing-failed",
    message: boundedString(cause instanceof Error ? cause.message : "AnyDoc ingestion failed.", MAX_FAILURE_MESSAGE_CHARACTERS),
    retryable: retryable === true,
    ...(typeof format === "string" ? { format: boundedString(format, MAX_FAILURE_FIELD_CHARACTERS) } : {}),
    ...(typeof status === "number" && Number.isFinite(status) ? { status } : {}),
    ...(limits ? { limits } : {}),
  };
  return `${FAILURE_MARKER}${encodeURIComponent(JSON.stringify(failure))}`;
}

/** Accepts either Workpool's complete result or its error string. */
export function decodeConvexIngestionFailure(value: OnCompleteArgs["result"] | string | unknown): ConvexIngestionFailure | undefined {
  const text = typeof value === "string"
    ? value
    : value && typeof value === "object" && "kind" in value && value.kind === "failed" && "error" in value
      ? String(value.error)
      : undefined;
  if (!text) return undefined;
  const start = text.indexOf(FAILURE_MARKER);
  if (start < 0) return undefined;
  const encoded = text.slice(start + FAILURE_MARKER.length).match(/^[A-Za-z0-9%_.!~*'()-]+/)?.[0];
  if (!encoded) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as Partial<ConvexIngestionFailure>;
    if (
      parsed.version !== 1
      || parsed.kind !== "anydoc-ingestion-failure"
      || typeof parsed.code !== "string"
      || Array.from(parsed.code).length > MAX_FAILURE_FIELD_CHARACTERS
      || typeof parsed.message !== "string"
      || Array.from(parsed.message).length > MAX_FAILURE_MESSAGE_CHARACTERS
      || typeof parsed.retryable !== "boolean"
      || (parsed.format !== undefined && (typeof parsed.format !== "string" || Array.from(parsed.format).length > MAX_FAILURE_FIELD_CHARACTERS))
      || (parsed.status !== undefined && (typeof parsed.status !== "number" || !Number.isFinite(parsed.status)))
      || (parsed.limits !== undefined && (
        !parsed.limits
        || typeof parsed.limits !== "object"
        || Array.isArray(parsed.limits)
        || Object.keys(parsed.limits).length > LIMIT_KEYS.size
        || Object.entries(parsed.limits).some(([key, item]) => !LIMIT_KEYS.has(key) || !(
          (typeof item === "number" && Number.isFinite(item))
          || (typeof item === "string" && Array.from(item).length <= MAX_FAILURE_FIELD_CHARACTERS)
        ))
      ))
    ) return undefined;
    return parsed as ConvexIngestionFailure;
  } catch {
    return undefined;
  }
}
