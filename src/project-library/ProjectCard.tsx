import { useId } from "react";
import { ArrowRight, CircleAlert, Clock, Ellipsis, RotateCcw } from "lucide-react";
import type { LibraryProject, LibrarySummary } from "../../shared/project-library/index.ts";
import { projectStatus } from "./project-status.ts";
import { formatAge, plural } from "./update-format.ts";

interface Props {
  project: LibraryProject; summary?: LibrarySummary | undefined; now: number; pathHint?: string | undefined;
  onOpen: () => void; onDetails: () => void; onActivity: () => void; onUpdates: () => void;
  onRestore?: () => void; restoreDisabled?: boolean;
}

export function ProjectCard({ project, summary, now, pathHint, onOpen, onDetails, onActivity, onUpdates, onRestore, restoreDisabled = false }: Props) {
  const activityId = useId(), attentionId = useId();
  const status = projectStatus(project, summary, now);
  const actionable = ["running", "attention", "waiting", "new"].includes(status.state);
  const recent = (status.unread ?? 0) > 0 && summary?.recent?.projectId === project.id && summary.recent.unread && Number.isFinite(summary.recent.at) ? summary.recent : null;
  const openedAt = project.lastOpened ? Date.parse(project.lastOpened) : NaN;
  const state = ["quiet", "archived"].includes(status.state) ? undefined : status.state;

  return <article className={`pl-card${project.archived ? " pl-card--archived" : ""}`} data-state={state} aria-label={project.name}>
    <header>
      <h3><button type="button" className="pl-name" title={project.path} aria-label={project.archived ? `View details for ${project.name}` : `Open ${project.name}`} onClick={project.archived ? onDetails : onOpen}>{project.name}</button></h3>
      <button type="button" className="pl-more pl-card-secondary" title="Project details" aria-label={`Details and organization for ${project.name}`} onClick={onDetails}><Ellipsis size={18} aria-hidden="true" /></button>
    </header>
    {(project.archived || pathHint) && <p className="pl-path" title={project.path}>{project.archived ? project.path : pathHint}</p>}
    {!project.archived && <>
      {actionable && <button type="button" className="pl-state" data-state={status.state} aria-label={status.label} aria-describedby={status.description ? activityId : status.state === "attention" && status.attentionDetail ? attentionId : undefined} onClick={status.state === "new" ? onUpdates : onActivity}>
        {status.state === "attention" ? <CircleAlert size={14} aria-hidden="true" /> : status.state === "waiting" ? <Clock size={14} aria-hidden="true" /> : null}
        <span className="pl-state-label">{status.label}{status.state === "attention" && status.attentionDetail && <span className="pl-attention-detail" id={attentionId}>{status.attentionDetail}</span>}</span><ArrowRight size={14} aria-hidden="true" />
      </button>}
      {status.state === "unknown" && <p className="pl-card-status-note">{status.label}</p>}
      {status.description && <p className="pl-card-agents" id={activityId}>{status.description}</p>}
      {status.running && status.attentionCount > 0 && <button type="button" className="pl-state" data-state="attention" aria-label="Needs attention" aria-describedby={status.attentionDetail ? attentionId : undefined} onClick={onActivity}><CircleAlert size={14} aria-hidden="true" /><span>Needs attention{status.attentionDetail && <span className="pl-attention-detail" id={attentionId}>{status.attentionDetail}</span>}</span><ArrowRight size={14} aria-hidden="true" /></button>}
      {!status.running && recent && <div className="pl-recent-row"><p className="pl-recent" title={recent.text}>{recent.text}</p></div>}
      {(status.unread ?? 0) > 0 && <footer>
        <button type="button" className="pl-unread" aria-label={`${status.unread} new updates for ${project.name}`} onClick={onUpdates}>View {plural(status.unread!, "update")}<ArrowRight size={15} aria-hidden="true" /></button>
        {recent && <time dateTime={new Date(recent.at).toISOString()} title={new Date(recent.at).toLocaleString()}>{formatAge(recent.at, now)}</time>}
      </footer>}
    </>}
    {project.archived && <>
      {project.tags.length > 0 && <p className="pl-archive-tags" title={project.tags.join(", ")}>{project.tags.slice(0, 2).join(" · ")}{project.tags.length > 2 ? ` · +${project.tags.length - 2} more` : ""}</p>}
      <div className="pl-archive-actions">
        {Number.isFinite(openedAt) && <span className="pl-last-opened">Last opened <time dateTime={new Date(openedAt).toISOString()} title={new Date(openedAt).toLocaleString()}>{formatAge(openedAt, now)}</time></span>}
        {onRestore && <button type="button" className="pl-restore" disabled={restoreDisabled} aria-label={`Restore ${project.name} to Library`} onClick={onRestore}><RotateCcw size={15} aria-hidden="true" />Restore to Library</button>}
      </div>
    </>}
  </article>;
}
