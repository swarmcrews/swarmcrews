import { useCallback, useEffect, useRef, useState } from "react";
import { listProjects, type ProjectSummary } from "./api.ts";

const RECHECK_MS = 5_000;

/** Recover startup failures and empty lists without requiring a page reload. */
export function useProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const reload = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;
    let pending = false;
    let needsRecheck = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (active && needsRecheck) timer = setTimeout(recheck, RECHECK_MS);
    };
    const refresh = async (background = false) => {
      if (!active || pending) return;
      pending = true;
      clearTimeout(timer);
      if (!background) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await listProjects();
        if (!active) return;
        setProjects(result);
        setError(null);
        needsRecheck = result.length === 0;
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load projects");
        needsRecheck = true;
      } finally {
        pending = false;
        if (active) {
          setLoading(false);
          schedule();
        }
      }
    };
    function recheck() {
      if (!active || !needsRecheck || pending) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      // Keep the confirmed empty/error state visible during background checks.
      void refresh(true);
    }

    refreshRef.current = () => { void refresh(); };
    void refresh();
    window.addEventListener("online", recheck);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      active = false;
      clearTimeout(timer);
      refreshRef.current = () => {};
      window.removeEventListener("online", recheck);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  return { projects, setProjects, loading, error, reload };
}
