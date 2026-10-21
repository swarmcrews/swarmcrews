import { Activity, Archive, Bell, LayoutDashboard, Pin, PinOff, RotateCcw } from "lucide-react";
import type { LibraryProject } from "../../shared/project-library/index.ts";
import { LibraryNotice } from "./LibraryNotice.tsx";
import type { ProjectDestination } from "./model.ts";

interface Props {
  project: LibraryProject; disabled: boolean; busy: boolean; recoveryNeeded: boolean;
  actionError: string | null; feedback: string | null;
  onDesk: () => void; onUpdates: () => void; onRestore: () => void; onOpen: (destination: ProjectDestination) => void; onArchive: () => void; onRecover: () => void;
}

/** Grouped by intent: arrange and open in an even grid, then the one destructive-feeling action on its own row. */
export function OrganizationActions({ project, disabled, busy, recoveryNeeded, actionError, feedback, onDesk, onUpdates, onRestore, onOpen, onArchive, onRecover }: Props) {
  const pinned = project.focusOrder !== null;
  return <div className="pl-org-actions">
    <div className="pl-org-group">
      <button type="button" disabled={disabled || project.archived} onClick={onDesk}>{pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}{pinned ? "Remove from desk" : "Add to desk"}</button>
      <button type="button" disabled={disabled} onClick={onUpdates}><Bell size={16} aria-hidden="true" />Updates</button>
      {project.archived
        ? <button type="button" disabled={disabled} onClick={onRestore}><RotateCcw size={16} aria-hidden="true" />Restore to Library</button>
        : <>
          <button type="button" disabled={disabled} onClick={() => onOpen({ view: "activity" })}><Activity size={16} aria-hidden="true" />Open Activity</button>
          <button type="button" disabled={disabled} onClick={() => onOpen({ view: "canvas" })}><LayoutDashboard size={16} aria-hidden="true" />Open Canvas</button>
        </>}
    </div>
    {!project.archived && <div className="pl-org-group pl-org-group--danger">
      <button className="pl-action--danger" type="button" disabled={disabled} onClick={onArchive}><Archive size={16} aria-hidden="true" />Archive project</button>
      <span>Hides it from Library and Focus. Files and history are preserved.</span>
    </div>}
    {actionError && <LibraryNotice tone="error" alert actions={recoveryNeeded ? <button type="button" disabled={busy} onClick={onRecover}>Refresh before retrying</button> : undefined}>{actionError}</LibraryNotice>}
    {feedback && <LibraryNotice tone="success">{feedback}</LibraryNotice>}
  </div>;
}
