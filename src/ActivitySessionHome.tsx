import type { ReactNode } from "react";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import type { BriefingGroup } from "./activity-return-briefing.ts";
import type { ActivityBriefing } from "./use-activity-return-briefing.ts";
import "./activity-return-briefing.css";

const sections: { id: BriefingGroup; title: string; description: string }[] = [
  { id: "input", title: "Needs your input", description: "New or changed requests. Open a session for options and consequences." },
  { id: "outcome", title: "What moved forward", description: "Recorded outcomes, not proof of verification or integration." },
  { id: "resume", title: "Worth picking back up", description: "Errors and interruptions with context to help you resume." },
];
const groupActions: Record<BriefingGroup, string> = {
  input: "Review request",
  outcome: "View result",
  resume: "Resume work",
};
const formatTime = (at: number) => new Date(at).toLocaleString(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export function ActivitySessionHome({ briefing, onOpenSession, onLaunch, canvasPreview }: {
  canvasPreview?: ReactNode;
  briefing: ActivityBriefing | null;
  onOpenSession: (sessionKey: string) => void;
  onLaunch: () => void;
}) {
  const groups = sections.map(section => ({ ...section,
    entries: briefing?.entries.filter(entry => entry.group === section.id) ?? [],
  }));
  const summary = groups.filter(group => group.entries.length > 0).map(group =>
    `${group.entries.length} ${group.id === "input" ? "input request" : group.id === "outcome" ? "outcome" : "interruption"}${group.entries.length === 1 ? "" : "s"}`,
  ).join(" · ");
  return (
    <main className="act-session-home act-return-briefing" aria-label="Activity return briefing">
      <div className="act-session-home__content">
        <header className="act-session-home__heading">
          <div>
            <span>Your return briefing</span>
            <h2>Since your last visit</h2>
            <p>What changed while you were away. Your full work list stays in the sidebar.</p>
          </div>
          <button className="act-session-home__new" type="button" onClick={onLaunch}>
            <Plus size={14} aria-hidden /><span>New leader</span>
          </button>
        </header>
        {canvasPreview}
        {!briefing ? <p className="act-briefing-note">Loading your briefing…</p> : <>
          <div className="act-briefing-window">
            <div>
              <p>{briefing.window === "week" ? "Latest recorded changes from the past 7 days"
                : briefing.firstVisit ? "First visit on this browser · Latest recorded changes from the past 24 hours"
                : "Changes since your last visit on this browser"}</p>
              <p><time dateTime={new Date(briefing.since).toISOString()}>{formatTime(briefing.since)}</time>
                {" — "}<time dateTime={new Date(briefing.capturedAt).toISOString()}>{formatTime(briefing.capturedAt)}</time></p>
            </div>
            <label>Look back
              <select value={briefing.window} onChange={event => briefing.setWindow(event.target.value === "week" ? "week" : "visit")}>
                <option value="visit">{briefing.firstVisit ? "Past 24 hours" : "Since last visit"}</option>
                <option value="week">Past 7 days</option>
              </select>
            </label>
          </div>
          {!briefing.historyAvailable && <p className="act-briefing-note">Visit history is unavailable in this browser. Showing recent recorded changes instead.</p>}
          <div className="act-briefing-updates" aria-live="polite">
            {briefing.updateCount > 0 && <button type="button" className="act-session-home__open" onClick={briefing.refresh}>
              <RefreshCw size={14} aria-hidden />{briefing.updateCount} new {briefing.updateCount === 1 ? "update" : "updates"} · Refresh briefing
            </button>}
          </div>
          {summary ? <p className="act-briefing-summary">{summary}</p> : <div className="act-briefing-quiet">
            <h3>{briefing.window === "visit" && !briefing.firstVisit ? "Nothing new since your last visit." : "No recorded changes in this window."}</h3>
            <p>Your work is available in the sidebar.</p>
          </div>}
          {groups.filter(group => group.entries.length > 0).map(group => (
            <section className="act-session-more" key={group.id} aria-labelledby={`briefing-${group.id}`}>
              <header className="act-session-more__heading"><div>
                <h3 id={`briefing-${group.id}`}>{group.title}</h3><p>{group.description}</p>
              </div></header>
              <div className="act-session-more__list">
                {group.entries.map(entry => {
                  const action = groupActions[group.id];
                  const sourceLabel = entry.sourceAvailable === false ? "Source unavailable" : action;
                  return <button type="button" className="act-session-row" key={entry.id}
                  aria-label={`${sourceLabel}: ${entry.title}`}
                  disabled={entry.sourceAvailable === false} onClick={() => onOpenSession(entry.sessionKey)}>
                  <span className={`act-session-row__signal act-session-row__signal--${group.id === "input" ? "attention" : group.id === "outcome" ? "changes" : "error"}`} aria-hidden />
                  <span className="act-session-row__body">
                    <span className="act-briefing-entry-heading">
                      <span className="act-session-row__topline"><strong>{entry.title}</strong><span>{entry.label}</span></span>
                      <span className="act-briefing-source">{sourceLabel}
                        {entry.sourceAvailable !== false && <ArrowRight size={14} aria-hidden />}
                      </span>
                    </span>
                    {entry.detail && <span className="act-session-row__summary">Recorded context: {entry.detail}</span>}
                    <span className="act-session-row__meta">
                      {entry.changesAvailable ? "Changes available to review · " : ""}
                      {entry.at ? formatTime(entry.at) : "Event time unavailable"}
                      {entry.sourceAvailable === false && " · Source no longer in loaded activity"}
                    </span>
                  </span>
                </button>;
                })}
              </div>
            </section>
          ))}
          <p className="act-briefing-note">A snapshot of the latest loaded state per work item, not a complete event history.
            {" "}Opening this briefing does not acknowledge decisions or reviews.</p>
        </>}
      </div>
    </main>
  );
}
