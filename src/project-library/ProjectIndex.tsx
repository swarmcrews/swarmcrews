import { useId } from "react";
import { ArrowRight, CircleAlert, Clock, Ellipsis } from "lucide-react";
import { CrewIcon } from "../components/CrewIcon.tsx";
import { LeaderStatusIcon } from "../nodes/leader/LeaderStatusIcon.tsx";
import type { LibraryActivity, LibraryProject, LibrarySummary } from "../../shared/project-library/index.ts";
import { activityTimestamp } from "./model.ts";
import { projectStatus } from "./project-status.ts";
import { formatAge } from "./update-format.ts";

export function ProjectIndexRow({ project, summary, activity, now, pathHint, onOpen, onDetails, onActivity, onUpdates }: {
  project: LibraryProject; summary?: LibrarySummary | undefined; activity?: LibraryActivity | undefined; now: number; pathHint?: string | undefined;
  onOpen: () => void; onDetails: () => void; onActivity: () => void; onUpdates: () => void;
}) {
  const status = projectStatus(project, summary, now), descriptionId = useId();
  const at = activityTimestamp(project, activity);
  const timeTitle = at ? `${activity?.recent ? "Latest activity" : "Last opened"}: ${new Date(at).toLocaleString()}` : "No recorded activity or opens";
  const actionable = ["running", "attention", "waiting", "new"].includes(status.state);
  return <article className="pl-index-row" aria-label={project.name}>
    <div className="pl-index-identity"><h3><button type="button" className="pl-index-name pl-project-action" title={project.path} aria-label={`Open ${project.name}`} onClick={onOpen}><span>{project.name}</span><ArrowRight size={14} aria-hidden="true" /></button></h3>{pathHint && <span className="pl-index-path" title={project.path}>{pathHint}</span>}</div>
    <div className="pl-index-activity">
    <div className="pl-index-state" data-state={status.state}>
      {actionable ? <button type="button" className="pl-inline-action" aria-label={status.label} aria-describedby={status.description || status.attentionDetail ? descriptionId : undefined} onClick={status.state === "new" ? onUpdates : onActivity}>
        {status.state === "attention" && <CircleAlert className="pl-attention-icon" size={14} aria-hidden="true" />}
        {status.state === "waiting" && <Clock size={14} aria-hidden="true" />}
        {status.running && status.description ? <span className="pl-index-agents" aria-hidden="true">{status.leaders > 0 && <span><LeaderStatusIcon active decorative size={12} />{status.leaders} leader{status.leaders === 1 ? "" : "s"}</span>}{status.crew > 0 && <span><CrewIcon size={12} />{status.crew} crew</span>}</span> : <span>{status.label}{status.attentionDetail && <span className="pl-attention-detail">{status.attentionDetail}</span>}</span>}<ArrowRight className="pl-status-arrow" size={14} aria-hidden="true" />
      </button> : <span>{status.label}</span>}
      {(status.description || status.attentionDetail) && <span id={descriptionId} className="pl-sr-only">{status.description || status.attentionDetail}</span>}
    </div>
    {status.unread !== null && status.unread > 0 && <div className="pl-index-unread"><button type="button" className="pl-inline-action" aria-label={`${status.unread} new updates for ${project.name}`} onClick={onUpdates}><span className="pl-new-badge">{status.unread} new</span></button></div>}
    </div>
    <span className="pl-index-time" title={timeTitle}>{at ? <time dateTime={new Date(at).toISOString()}>{formatAge(at, now)}</time> : "—"}</span>
    <button type="button" className="pl-index-more pl-inline-action" title="Project details" aria-label={`Details and organization for ${project.name}`} onClick={onDetails}><Ellipsis size={18} aria-hidden="true" /></button>
  </article>;
}

export function ProjectIndexSkeleton() {
  return <div className="pl-index-skeleton" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index}><span /><span /></div>)}</div>;
}
