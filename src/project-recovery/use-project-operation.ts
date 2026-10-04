import { projectErrorMessage } from "./project-error.ts";
import { useCallback, useEffect, useRef, useState } from "react";

export type ProjectOperationState =
  | { status: "idle" | "pending" | "success" }
  | { status: "error"; error: string };

/** Synchronous lock also guards Enter + blur/click in the same render. Never auto-retries. */
export function useProjectOperation() {
  const [state, setState] = useState<ProjectOperationState>({ status: "idle" });
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const clear = useCallback(() => { if (!pending.current) setState({ status: "idle" }); }, []);
  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<{ value: T } | undefined> => {
    if (pending.current) return;
    pending.current = true;
    setState({ status: "pending" });
    try {
      const value = await operation();
      if (!mounted.current) return undefined;
      setState({ status: "success" });
      return { value };
    } catch (reason) {
      if (mounted.current) setState({ status: "error", error: projectErrorMessage(reason) });
      return undefined;
    } finally { pending.current = false; }
  }, []);
  return { state, run, clear, pending: state.status === "pending" };
}
