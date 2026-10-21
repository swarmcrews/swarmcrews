import { librarySummaryFreshness, type LibraryProject, type LibrarySummary } from "../../shared/project-library/index.ts";

/** Shared by cards and the index: recency/unread never imply live execution. */
export function projectStatus(project: LibraryProject, summary: LibrarySummary | undefined, now: number) {
  const fresh = summary?.projectId === project.id && librarySummaryFreshness(summary, now) === "fresh";
  const current = fresh && !project.archived ? summary : undefined;
  const known = !!current && current.state !== "unknown";
  const running = known && (current.running === undefined ? current.state === "running" : current.running === true);
  const leaders = running ? (current?.runningLeaders === undefined ? current?.activeLeaders ?? 0 : current.runningLeaders ?? 0) : 0;
  const crew = running ? current?.activeCrew ?? 0 : 0;
  const description = [leaders ? `${leaders} active leader${leaders === 1 ? "" : "s"}` : null, crew ? `${crew} active crew` : null].filter(Boolean).join(" · ");
  const unread = current?.unread ?? null;
  const attentionCount = known ? current.attention?.total ?? 0 : 0;
  const attentionDetail = attentionCount > 0 && current?.attention
    ? ([ ["decision", current.attention.decision], ["review", current.attention.review], ["conflict", current.attention.conflict] ] as const)
      .filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`).join(" · ")
    : "";
  const waiting = known && current.running === false && (current.state === "running" || [current.activeWorkItems, current.activeLeaders, current.activeCrew, current.activeOther].some(count => (count ?? 0) > 0));
  const quiet = known && current.state === "up_to_date" && current.running !== null && current.unread === 0 && current.activeLeaders === 0 && current.activeCrew === 0 && current.activeOther === 0 && current.activeWorkItems === 0 && current.attention?.total === 0;
  const state = project.archived ? "archived" : !known ? "unknown" : running ? "running" : attentionCount > 0 ? "attention" : waiting ? "waiting" : (unread ?? 0) > 0 ? "new" : quiet ? "quiet" : "unknown";
  const label = { archived: "Archived", unknown: summary ? "Status unavailable" : "Checking status…", running: "Running", attention: "Needs attention", new: "New updates", waiting: "Waiting", quiet: "No active work" }[state];
  return { state, label, running, leaders, crew, description, unread, attentionCount, attentionDetail };
}
