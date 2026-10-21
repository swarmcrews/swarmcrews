import { Archive, FolderPlus, Inbox, SearchX } from "lucide-react";
import type { LibraryFilters, ProjectLayout } from "./model.ts";

export function LibrarySkeleton({ layout }: { layout: ProjectLayout }) {
  return <div className={`pl-projects pl-projects--${layout} pl-skeleton`} aria-hidden="true">
    {Array.from({ length: 6 }, (_, i) => <div className="pl-skeleton-card" key={i}><span /><span /><span /></div>)}
  </div>;
}

/** Context-aware empty state: explains why nothing is shown and offers at most one way forward. */
export function LibraryEmpty({ total, filters, filtered, onChange }: { total: number; filters: LibraryFilters; filtered: boolean; onChange: (value: Partial<LibraryFilters>) => void }) {
  const Icon = total === 0 ? FolderPlus : filtered ? SearchX : filters.view === "archived" ? Archive : Inbox;
  const title = total === 0 ? "Start with a project" : filtered ? "No matching projects" : filters.view === "focus" ? "Your focus desk is empty" : filters.view === "archived" ? "No archived projects" : "No projects in Library";
  const body = total === 0 ? "Add a repository above to register your first project. Registering never starts work."
    : filtered ? "Try a different search, or clear the filters above."
    : filters.view === "focus" ? "Choose a Library project, then add it to your desk in Details. This never starts work."
    : filters.view === "archived" ? "Archived projects keep their files and history. They can be restored at any time."
    : "Every registered project is archived. Restore one from Archived to see it here.";
  const action = filtered || total === 0 ? null : filters.view === "library" ? { label: "View archived", view: "archived" as const } : { label: "Show Library", view: "library" as const };
  return <div className="pl-empty"><Icon className="pl-empty-icon" size={28} aria-hidden="true" /><h2>{title}</h2><p>{body}</p>{action && <button type="button" onClick={() => onChange({ view: action.view })}>{action.label}</button>}</div>;
}
