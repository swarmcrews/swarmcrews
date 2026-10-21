import { BellOff, CheckCheck, ChevronDown, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { librarySummaryFreshness, type LibraryEvent, type LibraryEventPage, type LibraryProject, type LibrarySummary } from "../../shared/project-library/index.ts";
import { acknowledgeAll, acknowledgeEvents, getLibraryEvents } from "./api.ts";
import { LibraryDialog } from "./LibraryDialog.tsx";
import { LibraryNotice } from "./LibraryNotice.tsx";
import { EventRow, EventSkeleton } from "./UpdateRows.tsx";
import type { ProjectDestination } from "./model.ts";

type Filter = "unread" | "all";
const key = (event: Pick<LibraryEvent, "id" | "revision">) => `${event.id}:${event.revision}`;

export function ProjectUpdates({ project, summary, now, onClose, onRead, onOpen }: { project: LibraryProject; summary?: LibrarySummary | undefined; now: number; onClose: () => void; onRead: () => void; onOpen: (destination: ProjectDestination) => void }) {
  const [pages, setPages] = useState<LibraryEventPage[]>([]);
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const [allCleared, setAllCleared] = useState(false);
  const [filter, setFilter] = useState<Filter>("unread");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let stopped = false; setLoading(true); setError(null);
    void getLibraryEvents(project.id).then(events => {
      if (stopped) return;
      setPages([events]); setAcked(new Set()); setAllCleared(false);
      setFilter("unread");
    }).catch(err => { if (!stopped) setError(err instanceof Error ? err.message : "Couldn’t load updates"); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [project.id, reloadKey]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return; setBusy(true); setError(null);
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : fallback); } finally { setBusy(false); }
  };
  const entries = pages.flatMap(page => page.events.map(event => ({ event, page })));
  const isUnread = (event: LibraryEvent) => event.unread && !acked.has(key(event));
  const unreadCount = entries.filter(({ event }) => isUnread(event)).length;
  const moreEvents = pages.at(-1)?.nextCursor ?? null;
  const olderUnknown = !!moreEvents && !allCleared;
  const shown = filter === "unread" ? entries.filter(({ event }) => isUnread(event)) : entries;
  const newestAt = entries.length ? entries.reduce((max, { event }) => Math.max(max, event.at), 0) : null;
  const markOne = (event: LibraryEvent, page: LibraryEventPage) => run(async () => { await acknowledgeEvents(project.id, page, [event]); setAcked(previous => new Set(previous).add(key(event))); onRead(); }, "Couldn’t mark read");
  // Clears everything up to the newest update you were shown, including older pages; later arrivals stay unread.
  const markAll = () => newestAt !== null && run(async () => {
    await acknowledgeAll({ asOf: newestAt, projectIds: [project.id] });
    setAcked(new Set(entries.map(({ event }) => key(event)))); setAllCleared(true); onRead();
    try {
      const fresh = await getLibraryEvents(project.id);
      setPages([fresh]); setAcked(new Set()); setAllCleared(!fresh.nextCursor || fresh.events.some(event => !event.unread));
    } catch { /* The optimistic read state is already correct for everything that was shown. */ }
  }, "Couldn’t mark read");
  const loadOlder = () => moreEvents && run(async () => { const next = await getLibraryEvents(project.id, moreEvents); setPages(previous => [...previous, next]); }, "Couldn’t load older updates");

  const status = loading ? "" : unreadCount > 0 ? `${unreadCount}${olderUnknown ? "+" : ""} unread` : olderUnknown ? "No unread in the newest updates" : "All caught up";
  const footer = <>
    <span className="pl-footer-status" role="status">{status}</span>
    <button className="pl-action--primary" type="button" disabled={busy || loading || newestAt === null || (unreadCount === 0 && !olderUnknown)} onClick={() => void markAll()}><CheckCheck size={16} aria-hidden="true" />{busy ? "Working…" : "Mark all read"}</button>
  </>;
  const live = !!summary && librarySummaryFreshness(summary, now) === "fresh";
  const stats: Array<[string, string | number, string]> = [
    ["Unread", loading ? "—" : `${unreadCount}${olderUnknown ? "+" : ""}`, unreadCount > 0 ? "accent" : ""],
    ["Needs attention", live ? summary.attention?.total ?? "—" : "—", live && (summary.attention?.total ?? 0) > 0 ? "warning" : ""],
    ["Active leaders", live ? summary.activeLeaders ?? "—" : "—", ""],
  ];
  return <LibraryDialog sheet title={`Updates · ${project.name}`} busy={busy} footer={footer} onClose={onClose}>
    <section className="pl-updates-section" aria-label="Recorded updates">
      <div className="pl-updates-head"><h3>Recorded updates</h3>
        <div className="pl-segmented" role="group" aria-label="Show updates">
          <button type="button" aria-pressed={filter === "unread"} onClick={() => setFilter("unread")}>Unread{!loading && <span className="pl-count">{unreadCount}{olderUnknown ? "+" : ""}</span>}</button>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
        </div>
      </div>
      {error && <LibraryNotice tone="error" alert actions={<button type="button" disabled={busy} onClick={() => setReloadKey(k => k + 1)}>Reload updates</button>}>{error} Displayed updates are unchanged.</LibraryNotice>}
      {loading && <><p className="pl-sr-only" role="status">Loading updates…</p><EventSkeleton /></>}
      {!loading && shown.length > 0 && <ul className="pl-event-list">{shown.map(({ event, page }) => <EventRow key={key(event)} event={event} unread={isUnread(event)} busy={busy} now={now} onOpen={() => onOpen(event.destination)} onRead={() => void markOne(event, page)} />)}</ul>}
      {!loading && !error && shown.length === 0 && (entries.length === 0
        ? <div className="pl-updates-empty"><Inbox size={24} aria-hidden="true" /><strong>No recorded updates</strong><p>Work and context changes for this project will appear here.</p></div>
        : <div className="pl-updates-empty"><BellOff size={24} aria-hidden="true" /><strong>{olderUnknown ? "Nothing unread in the newest updates" : "You’re all caught up"}</strong><p>{olderUnknown ? "Older updates may still be unread." : "There are no unread updates for this project."}</p>{!olderUnknown && <button type="button" onClick={() => setFilter("all")}>Show all updates</button>}</div>)}
      {moreEvents && <button className="pl-load-more" type="button" disabled={busy} onClick={() => void loadOlder()}><ChevronDown size={16} aria-hidden="true" />Load older updates</button>}
    </section>
    <dl className="pl-updates-stats">{stats.map(([label, value, tone]) => <div className="pl-stat" data-tone={tone} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="pl-updates-section">
      {!live && <p className="pl-hint">Live status unavailable. Open Activity to check current work.</p>}
      <p className="pl-hint">Decisions, reviews and other work actions are in project Activity. Marking updates read does not resolve them.</p>
      <div><button type="button" onClick={() => onOpen({ view: "activity" })}>Open Activity</button></div>
    </div>
  </LibraryDialog>;
}
