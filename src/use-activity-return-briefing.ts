import { useEffect, useRef, useState } from "react";
import type { MobileSessionInfo } from "./mobile/mobile-selectors.ts";
import { BRIEFING_DAY, briefingEntries, briefingWork, captureBriefing, parseBriefingVisit, selectBriefingChanges,
  type BriefingEntry, type BriefingVisit } from "./activity-return-briefing.ts";

export const briefingStorageKey = (project: string) => `activity-return-briefing:v1:${encodeURIComponent(project)}`;
type Window = "visit" | "week";
interface Visit {
  project: string;
  baseline: BriefingVisit | null;
  snapshot: BriefingVisit;
  entries: BriefingEntry[];
  historyAvailable: boolean;
}
export interface ActivityBriefing {
  entries: (BriefingEntry & { sourceAvailable: boolean })[];
  since: number;
  capturedAt: number;
  firstVisit: boolean;
  historyAvailable: boolean;
  window: Window;
  setWindow: (window: Window) => void;
  updateCount: number;
  refresh: () => void;
}

function save(project: string, snapshot: BriefingVisit): boolean {
  try {
    localStorage.setItem(briefingStorageKey(project), JSON.stringify(snapshot));
    return true;
  } catch { return false; }
}

/** Owned by ActivityView, not the conditional home: opening a source never starts a new visit. */
export function useActivityReturnBriefing(sessions: MobileSessionInfo[], project: string | undefined,
  active: boolean, ready: boolean): ActivityBriefing | null {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const [visit, setVisit] = useState<Visit | null>(null);
  const current = useRef<Visit | null>(null);
  const [window, setWindow] = useState<Window>("visit");

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!active || !visible || !project) {
      current.current = null;
      setVisit(null);
      return;
    }
    if (!ready || current.current?.project === project) return;
    const now = Date.now();
    let baseline: BriefingVisit | null = null;
    let historyAvailable = true;
    try { baseline = parseBriefingVisit(localStorage.getItem(briefingStorageKey(project)), now); }
    catch { historyAvailable = false; }
    const snapshot = captureBriefing(sessions, now);
    historyAvailable = save(project, snapshot) && historyAvailable;
    const next = { project, baseline, snapshot, entries: briefingEntries(sessions), historyAvailable };
    current.current = next;
    setVisit(next);
    setWindow("visit");
  }, [sessions, project, active, ready, visible]);

  if (!visit || visit.project !== project) return null;
  const since = window === "week" ? visit.snapshot.at - 7 * BRIEFING_DAY
    : visit.baseline?.at ?? visit.snapshot.at - BRIEFING_DAY;
  const sources = briefingWork(sessions);
  const entries = selectBriefingChanges(visit.entries, window === "visit" ? visit.baseline : null, since).map(entry => {
    const source = sources.find(session => session.workItemId ? `work:${session.workItemId}` === entry.id
      : `session:${session.sessionKey}` === entry.id);
    return { ...entry, sessionKey: source?.sessionKey ?? entry.sessionKey, sourceAvailable: !!source };
  });
  const live = captureBriefing(sessions, visit.snapshot.at);
  // Also surface resolution/removal: a frozen decision should not silently look current forever.
  const newEntries = ready ? selectBriefingChanges(briefingEntries(sessions), visit.snapshot, visit.snapshot.at) : [];
  const changedIds = new Set(newEntries.map(entry => entry.id));
  if (ready) for (const [id, signature] of Object.entries(visit.snapshot.signatures)) {
    if (signature && live.signatures[id] !== signature) changedIds.add(id);
  }
  return { entries, since, capturedAt: visit.snapshot.at, firstVisit: !visit.baseline,
    historyAvailable: visit.historyAvailable, window, setWindow, updateCount: changedIds.size,
    refresh: () => {
      if (!ready || !active || !visible) return;
      const snapshot = captureBriefing(sessions, Date.now());
      const next = { ...visit, snapshot, entries: briefingEntries(sessions),
        historyAvailable: save(visit.project, snapshot) && visit.historyAvailable };
      current.current = next;
      setVisit(next);
    } };
}
