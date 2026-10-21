import { useCallback, useEffect, useState } from "react";
const DEADLINE_MS = 10000;
const hidden = () => document.visibilityState === "hidden";

/** One scoped batch, one in-flight request, no session inventory or per-card timers.
 * Hidden tabs stop; errors back off; a stalled transport cannot pin old status forever. */
export function useLibraryBatch<T extends { projectId: string; expiresAt: string }>(ids: string[], loadBatch: (ids: string[], signal: AbortSignal) => Promise<T[]>, pollMs: number, version = 0) {
  const [summaries, setSummaries] = useState<Record<string, T>>({});
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const refresh = useCallback(() => setRetryKey(value => value + 1), []);
  const scope = JSON.stringify([...new Set(ids)].sort());
  useEffect(() => {
    const projectIds = JSON.parse(scope) as string[];
    const allowed = new Set(projectIds);
    let stopped = false, pending = false, failures = 0, lastStarted = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    // Drop off-screen cache entries; an omitted response must not retain an old Running state.
    setSummaries(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => allowed.has(id))));
    const load = async (foreground = false) => {
      if (stopped) return;
      clearTimeout(timer);
      if (hidden() || !projectIds.length || pending) return;
      const cooldown = (foreground ? 500 : pollMs) - (Date.now() - lastStarted);
      if (cooldown > 0) { timer = setTimeout(() => void load(foreground), cooldown); return; }
      pending = true; lastStarted = Date.now();
      controller = new AbortController();
      const requestController = controller;
      try {
        const result = await Promise.race([
          loadBatch(projectIds, requestController.signal),
          new Promise<never>((_, reject) => { deadline = setTimeout(() => {
            reject(new Error("Status refresh timed out. Retrying…")); requestController.abort();
          }, DEADLINE_MS); }),
        ]);
        if (!stopped) {
          setSummaries(Object.fromEntries(result.filter(row => allowed.has(row.projectId)).map(row => [row.projectId, row])));
          setError(null); failures = 0;
        }
      } catch (err) {
        if (!stopped) { failures++; setError(err instanceof Error ? err.message : "Status unavailable"); }
      } finally {
        clearTimeout(deadline); pending = false;
        if (!stopped) {
          setNow(Date.now());
          if (!hidden()) timer = setTimeout(() => void load(), Math.min(15000, pollMs * 2 ** Math.min(failures, 3)));
        }
      }
    };
    const resume = () => { setNow(Date.now()); if (hidden()) clearTimeout(timer); else void load(true); };
    void load();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume); window.addEventListener("online", resume);
    return () => {
      stopped = true; clearTimeout(timer); clearTimeout(deadline); controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
    };
  }, [scope, version, retryKey, loadBatch, pollMs]);
  // Expire exactly once at the next snapshot boundary, even during a stalled request.
  useEffect(() => {
    const next = Math.min(...Object.values(summaries).map(row => Date.parse(row.expiresAt)).filter(time => Number.isFinite(time) && time > now));
    if (!Number.isFinite(next) || hidden()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - Date.now()));
    return () => clearTimeout(timer);
  }, [summaries, now]);
  return { summaries, now, error, refresh };
}
