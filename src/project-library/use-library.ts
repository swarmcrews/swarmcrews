import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryUnread, ProjectLibrary } from "../../shared/project-library/index.ts";
import { getLibrary, getLibraryUnread } from "./api.ts";
const isHidden = () => document.visibilityState === "hidden";
export function useLibrary() {
  const [library, setLibrary] = useState<ProjectLibrary>({ projects: [], collections: [], focusRevision: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useRef<(foreground?: boolean) => Promise<ProjectLibrary | null>>(async () => null);
  const reload = useCallback((foreground = true) => refresh.current(foreground), []);
  useEffect(() => {
    let stopped = false; let pending = false; let needsRecheck = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const load = async (foreground = true) => {
      if (stopped || pending) return null;
      pending = true; clearTimeout(timer);
      if (foreground) setLoading(true);
      try { const data = await getLibrary(controller.signal); if (!stopped) { setLibrary(data); setError(null); } needsRecheck = !data.projects.length; return data; }
      catch (err) { if (!stopped) setError(err instanceof Error ? err.message : "Couldn’t load Library"); needsRecheck = true; return null; }
      finally { pending = false; if (!stopped) { setLoading(false); if (needsRecheck) timer = setTimeout(check, 5000); } }
    };
    function check() { if (stopped || pending || !needsRecheck) return; clearTimeout(timer); if (!isHidden()) void load(false); else timer = setTimeout(check, 5000); }
    refresh.current = load; void load();
    window.addEventListener("online", check); window.addEventListener("focus", check); document.addEventListener("visibilitychange", check);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); refresh.current = async () => null; window.removeEventListener("online", check); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, []);
  return { library, setLibrary, loading, error, reload };
}
export { useLibrarySummaries, useLibraryActivity } from "./use-library-summaries.ts";

/** Library-wide unread total. Unknown (null) is shown as no total, never as zero. */
export function useLibraryUnread(version = 0) {
  const [unread, setUnread] = useState<LibraryUnread | null>(null);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const load = async () => {
      clearTimeout(timer);
      if (!isHidden()) {
        try { const result = await getLibraryUnread(controller.signal); if (!stopped) setUnread(result); }
        catch { if (!stopped) setUnread(null); }
      }
      if (!stopped) timer = setTimeout(() => void load(), 10000);
    };
    const visible = () => { if (!isHidden()) void load(); };
    void load();
    document.addEventListener("visibilitychange", visible); window.addEventListener("focus", visible);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [version]);
  return unread;
}
