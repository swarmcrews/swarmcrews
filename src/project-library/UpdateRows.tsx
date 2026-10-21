import { ChevronRight, Check, FileText, Workflow } from "lucide-react";
import type { LibraryEvent } from "../../shared/project-library/index.ts";
import { formatAge } from "./update-format.ts";

interface EventRowProps { event: LibraryEvent; unread: boolean; busy: boolean; now: number; onOpen: () => void; onRead: () => void }
export function EventRow({ event, unread, busy, now, onOpen, onRead }: EventRowProps) {
  const context = event.destination.view === "context";
  return <li className="pl-event" data-unread={unread}>
    <button type="button" className="pl-event-open" aria-label={`Open ${context ? "context" : "work item"}: ${event.text}`} onClick={onOpen}>
      <span className="pl-event-icon" aria-hidden="true">{context ? <FileText size={16} /> : <Workflow size={16} />}</span>
      <span className="pl-event-body">
        {unread && <span className="pl-sr-only">Unread. </span>}
        <span className="pl-event-text">{event.text}</span>
        <span className="pl-event-meta"><span>{context ? "Project context" : "Work item"}</span><time dateTime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString()}>{formatAge(event.at, now)}</time></span>
      </span>
      <ChevronRight className="pl-event-chevron" size={16} aria-hidden="true" />
    </button>
    {unread && <button type="button" className="pl-event-read" aria-label={`Mark read: ${event.text}`} title="Mark read" disabled={busy} onClick={onRead}><Check size={16} aria-hidden="true" /></button>}
  </li>;
}

export function EventSkeleton() {
  return <ul className="pl-event-list pl-event-skeleton" aria-hidden="true">{[0, 1, 2].map(i => <li key={i}><span /><span /></li>)}</ul>;
}
