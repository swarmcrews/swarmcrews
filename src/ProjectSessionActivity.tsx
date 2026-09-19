import { useEffect } from "react";
import { getProjectActivitySummary } from "./api.ts";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";

/** Badge-only requests never connect to the global session stream. */
export function ProjectSessionActivity({ projectIds, onSummaryChange }: {
  projectIds: string[];
  onSummaryChange: (summary: ProjectActivitySummary[]) => void;
}) {
  const scope = JSON.stringify(projectIds);
  useEffect(() => {
    const ids = JSON.parse(scope) as string[];
    if (!ids.length) return;
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const refresh = async () => {
      if (stopped || pending || document.visibilityState === "hidden") return;
      clearTimeout(timer);
      pending = true;
      try {
        const summary = await getProjectActivitySummary(ids, controller.signal);
        if (!stopped) onSummaryChange(summary);
      } catch {
        // Keep last-known counts; an unavailable first summary remains unknown.
      } finally {
        pending = false;
        if (!stopped) timer = setTimeout(() => { void refresh(); }, 5_000);
      }
    };
    const onVisible = () => { void refresh(); };
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [scope, onSummaryChange]);
  return null;
}
