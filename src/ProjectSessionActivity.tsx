import { useEffect } from "react";
import { getProjectActivitySummary } from "./api.ts";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";

const REFRESH_MS = 5_000;
const isHidden = () => document.visibilityState === "hidden";

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
    let lastCompletedAt = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const refresh = async () => {
      if (stopped || pending) return;
      clearTimeout(timer);
      if (isHidden()) return;
      // Focus and visibility events often arrive together. Honor the same
      // cadence for them as polling, even after failures or slow responses.
      const remaining = REFRESH_MS - (Date.now() - lastCompletedAt);
      if (remaining > 0) {
        timer = setTimeout(() => { void refresh(); }, remaining);
        return;
      }
      pending = true;
      try {
        const summary = await getProjectActivitySummary(ids, controller.signal);
        if (!stopped) onSummaryChange(summary);
      } catch {
        // Keep last-known counts; an unavailable first summary remains unknown.
      } finally {
        pending = false;
        lastCompletedAt = Date.now();
        if (!stopped && !isHidden()) {
          timer = setTimeout(() => { void refresh(); }, REFRESH_MS);
        }
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
