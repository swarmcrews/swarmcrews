import { librarySummaryFreshness, type LibraryActivity, type LibraryProject, type LibrarySummary, type ProjectLibrary } from "../../shared/project-library/index.ts";
import type { ProjectSummary } from "../api.ts";
export type ProjectLayout = "grid" | "list";
export interface LibraryFilters { view: "library" | "focus" | "archived"; query: string; collection: string; tag: string; sort: "activity" | "name" | "created"; layouts: { focus: ProjectLayout; archived: ProjectLayout } }
export const defaultFilters: LibraryFilters = { view: "library", query: "", collection: "", tag: "", sort: "activity", layouts: { focus: "grid", archived: "list" } };
export const projectLayout = (filters: LibraryFilters): ProjectLayout => filters.layouts[filters.view === "archived" ? "archived" : "focus"];
export function selectProjects(library: ProjectLibrary, filters: LibraryFilters, activity: Record<string, LibraryActivity> = {}) {
  const query = filters.query.trim().toLocaleLowerCase();
  return library.projects.filter(p => (filters.view === "archived" ? p.archived : !p.archived)
    && (filters.view !== "focus" || p.focusOrder !== null)
    && (!filters.collection || p.collectionIds.includes(filters.collection))
    && (!filters.tag || p.tags.includes(filters.tag))
    && (!query || [p.name, p.path, ...p.tags].some(value => value.toLocaleLowerCase().includes(query))))
    .sort((a, b) => filters.view === "focus" ? (a.focusOrder ?? 0) - (b.focusOrder ?? 0) :
      (filters.sort === "activity" ? activityTimestamp(b, activity[b.id]) - activityTimestamp(a, activity[a.id]) : filters.sort === "name" ? a.name.localeCompare(b.name) :
        Date.parse(b.createdAt) - Date.parse(a.createdAt)) || a.id.localeCompare(b.id));
}
export const focusIds = (library: ProjectLibrary) => library.projects.filter(p => !p.archived && p.focusOrder !== null).sort((a, b) => a.focusOrder! - b.focusOrder!).map(p => p.id);
export const asProjectSummary = (p: LibraryProject): ProjectSummary => ({ ...p, lastOpened: p.lastOpened ?? p.createdAt, hasSidecar: true });
/** Only repeated names need a visible repository hint; use the shortest unique suffix. */
export function projectPathHints(projects: LibraryProject[]) {
  const groups = new Map<string, LibraryProject[]>();
  for (const project of projects) {
    const key = `${project.archived}:${project.name}`;
    groups.set(key, [...(groups.get(key) ?? []), project]);
  }
  const hints = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const paths = group.map(project => project.path.split(/[\\/]+/).filter(Boolean));
    group.forEach((project, index) => {
      const parts = paths[index]!;
      let depth = 1;
      while (depth < parts.length && paths.some((other, i) => i !== index && other.slice(-depth).join("/") === parts.slice(-depth).join("/"))) depth++;
      hints.set(project.id, parts.slice(-depth).join("/"));
    });
  }
  return hints;
}
export function summaryLabel(summary: LibrarySummary | undefined, now: number) {
  if (!summary) return "Status unknown";
  const freshness = librarySummaryFreshness(summary, now);
  if (freshness !== "fresh") return freshness === "stale" ? "Status stale" : "Status unknown";
  if (summary.state === "attention" && summary.attention) return `${summary.attention.total} need attention`;
  if (summary.state === "running") return "Running";
  if (summary.state === "new") return "New updates";
  if (summary.state === "up_to_date" && summary.unread === 0 && summary.attention?.total === 0 && summary.activeLeaders === 0 && summary.activeCrew === 0 && summary.activeOther === 0 && summary.activeWorkItems === 0) return "Up to date";
  return "Status unknown";
}
export function loadFilters(): LibraryFilters {
  try { const value = JSON.parse(sessionStorage.getItem("swarmcrews:library-view") ?? "null") as Partial<LibraryFilters> | null;
    if (!value) return { ...defaultFilters };
    return { ...defaultFilters, query: typeof value.query === "string" ? value.query : "", collection: typeof value.collection === "string" ? value.collection : "", tag: typeof value.tag === "string" ? value.tag : "", view: ["library", "focus", "archived"].includes(value.view ?? "") ? value.view! : "library", sort: ["activity", "name", "created"].includes(value.sort ?? "") ? value.sort! : defaultFilters.sort, layouts: { focus: value.layouts?.focus === "list" ? "list" : "grid", archived: value.layouts?.archived === "grid" ? "grid" : "list" } };
  } catch { return { ...defaultFilters }; }
}
export function persistFilters(filters: LibraryFilters) { try { sessionStorage.setItem("swarmcrews:library-view", JSON.stringify(filters)); } catch { /* Storage may be disabled; in-memory state still works. */ } }
export interface ProjectDestination { view: "activity" | "canvas" | "context"; workItemId?: string }
export function rememberDestination(id: string, destination: ProjectDestination) { try { sessionStorage.setItem(`swarmcrews:project-destination:${id}`, JSON.stringify(destination)); } catch { /* optional memory */ } }
export function projectDestination(id: string): ProjectDestination {
  try { const value = JSON.parse(sessionStorage.getItem(`swarmcrews:project-destination:${id}`) ?? "null") as ProjectDestination | null;
    if (value && ["activity", "canvas", "context"].includes(value.view)) return { view: value.view, ...(typeof value.workItemId === "string" ? { workItemId: value.workItemId } : {}) };
  } catch { /* use explicit project fallback */ }
  return { view: "activity" };
}

/** Last-opened is only a fallback: background work can make any project most recent. */
export function activityTimestamp(project: LibraryProject, activity?: LibraryActivity) {
  if (activity?.projectId === project.id && activity.recent?.projectId === project.id && Number.isFinite(activity.recent.at)) return activity.recent.at;
  const opened = project.lastOpened ? Date.parse(project.lastOpened) : NaN;
  return Number.isFinite(opened) ? opened : 0;
}
export function recentHighlights(projects: LibraryProject[], activity: Record<string, LibraryActivity>) {
  return projects.filter(project => {
    const row = activity[project.id];
    return row?.projectId === project.id && (row.leaders?.length ?? 0) > 0;
  }).sort((a, b) => activity[b.id]!.leaders[0]!.at - activity[a.id]!.leaders[0]!.at || a.id.localeCompare(b.id)).slice(0, 3);
}
