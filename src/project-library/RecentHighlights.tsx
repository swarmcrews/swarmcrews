import { useId, useState } from "react";
import { ArrowRight, ChevronDown, MessageSquare } from "lucide-react";
import type { LibraryActivity, LibraryProject, LibrarySummary } from "../../shared/project-library/index.ts";
import { projectStatus } from "./project-status.ts";
import { formatAge } from "./update-format.ts";

export function RecentHighlights({ projects, activity, summaries, now, onOpen, onUpdates, onSelect }: {
  projects: LibraryProject[]; activity: Record<string, LibraryActivity>; summaries: Record<string, LibrarySummary>; now: number;
  onOpen: (project: LibraryProject) => void; onUpdates: (project: LibraryProject) => void;
  onSelect: (project: LibraryProject, workItemId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const featured = projects.filter(project => activity[project.id]?.projectId === project.id && (activity[project.id]?.leaders?.length ?? 0) > 0).slice(0, 3);
  if (!featured.length) return null;
  const expandable = featured.some(project => activity[project.id]!.leaders.length > 1);
  return <section className="pl-highlights" aria-label="Recent conversations">
    <div className="pl-section-heading"><h2>Recent conversations</h2>{expandable && <button type="button" className="pl-highlights-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer conversations" : "Show more conversations"}<ChevronDown size={14} aria-hidden="true" /></button>}</div>
    <div id={listId} className="pl-highlight-grid">{featured.map(project => {
      const leaders = activity[project.id]!.leaders.slice(0, expanded ? 3 : 1);
      const { unread } = projectStatus(project, summaries[project.id], now);
      return <article className="pl-highlight-card" key={project.id} aria-label={`Recent conversations for ${project.name}`}>
        <header>
          <h3><button type="button" className="pl-highlight-project pl-project-action" title={project.path} onClick={() => onOpen(project)} aria-label={`Open ${project.name} from recent conversations`}><span>{project.name}</span><ArrowRight size={14} aria-hidden="true" /></button></h3>
          {unread !== null && unread > 0 && <button type="button" className="pl-highlight-new pl-inline-action" onClick={() => onUpdates(project)} aria-label={`${unread} new updates for ${project.name} from highlights`}><span className="pl-new-badge">{unread} new</span></button>}
        </header>
        <ul className="pl-highlight-sessions">{leaders.map(leader => <li key={leader.workItemId}>
          <button type="button" className="pl-highlight-session pl-inline-action" title={leader.title} aria-label={`Open leader session: ${leader.title}`} onClick={() => onSelect(project, leader.workItemId)}>
            <MessageSquare size={14} aria-hidden="true" /><span>{leader.title}</span>
            <time dateTime={new Date(leader.at).toISOString()} title={new Date(leader.at).toLocaleString()}>{formatAge(leader.at, now)}</time>
          </button>
        </li>)}</ul>
      </article>;
    })}</div>
  </section>;
}
