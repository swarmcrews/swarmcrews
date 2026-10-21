import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LayoutDashboard, Pin, PinOff } from "lucide-react";
import type { LibraryProject } from "../../shared/project-library/index.ts";
import type { ProjectLayout, ProjectDestination } from "./model.ts";

/** Quick links to the focus desk, shown above the Library grid. */
export function DeskStrip({ projects, onOpen }: { projects: LibraryProject[]; onOpen: (project: LibraryProject) => void }) {
  return <section className="pl-desk-strip" aria-label="Pinned projects">
    <h2><Pin size={14} aria-hidden="true" />Pinned</h2>
    <div>
      {projects.map(p => <button type="button" key={p.id} onClick={() => onOpen(p)}>{p.name}</button>)}
    </div>
  </section>;
}

interface DeskActionsProps {
  project: LibraryProject; layout: ProjectLayout; first: boolean; last: boolean; disabled: boolean;
  onMove: (delta: number) => void; onRemove: () => void; onOpen: (destination: ProjectDestination) => void;
}

/** Reorder and open controls attached to a desk card. Vertical lists reorder up and down. */
export function DeskActions({ project, layout, first, last, disabled, onMove, onRemove, onOpen }: DeskActionsProps) {
  const [Earlier, Later] = layout === "list" ? [ArrowUp, ArrowDown] : [ArrowLeft, ArrowRight];
  return <div className="pl-desk-actions" role="group" aria-label={`Focus desk actions for ${project.name}`}>
    <div className="pl-desk-arrange pl-card-secondary">
    <button type="button" title="Move earlier" disabled={disabled || first} aria-label={`Move ${project.name} earlier`} onClick={() => onMove(-1)}><Earlier size={16} aria-hidden="true" /><span className="pl-sr-only">Earlier</span></button>
    <button type="button" title="Move later" disabled={disabled || last} aria-label={`Move ${project.name} later`} onClick={() => onMove(1)}><Later size={16} aria-hidden="true" /><span className="pl-sr-only">Later</span></button>
    <button type="button" title="Remove from desk" disabled={disabled} aria-label={`Remove ${project.name} from desk`} onClick={onRemove}><PinOff size={16} aria-hidden="true" /><span className="pl-sr-only">Remove</span></button>
    </div>
    <span className="pl-desk-spacer" aria-hidden="true" />
    <button type="button" onClick={() => onOpen({ view: "activity" })}><Activity size={16} aria-hidden="true" />Activity</button>
    <button type="button" onClick={() => onOpen({ view: "canvas" })}><LayoutDashboard size={16} aria-hidden="true" />Canvas</button>
  </div>;
}
