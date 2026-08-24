import { useEffect, useState } from "react";
import type { ViewerError } from "./errors.js";
import { toViewerError } from "./errors.js";

export function useAbortableValue<T>(
  load: (signal: AbortSignal) => Promise<T>,
  dependencies: ReadonlyArray<unknown>,
  fallback: { readonly code: "fetch-failed" | "render-failed"; readonly format: "pdf" | "docx" | "text" | "markdown"; readonly message: string },
  externalSignal?: AbortSignal,
  onError?: (error: ViewerError) => void,
) {
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | { readonly status: "ready"; readonly value: T }
    | { readonly status: "error"; readonly error: ViewerError }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const abort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (externalSignal?.aborted) abort();
    setState({ status: "loading" });
    void load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setState({ status: "ready", value });
      })
      .catch((cause: unknown) => {
        const error = toViewerError(cause, fallback);
        if (error.code === "aborted") return;
        setState({ status: "error", error });
        onError?.(error);
      });
    return () => {
      controller.abort();
      externalSignal?.removeEventListener("abort", abort);
    };
    // The caller owns dependency stability, like useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return state;
}
