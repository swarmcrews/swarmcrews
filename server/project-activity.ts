import type { SessionHost } from "./session-host.ts";
import { createWorkspaceSourceLookup } from "./workspace-registry.ts";
import { persistenceDb } from "./session-persist.ts";
import { withoutArchivedWork } from "./session-list-visibility.ts";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";

/** Count live leaders directly; no session detail or transcript projection. */
export function projectActivitySummary(
  entries: Iterable<[string, SessionHost]>, projectIds: string[],
): ProjectActivitySummary[] {
  const counts = new Map(projectIds.map((id) => [id, 0]));
  if (!counts.size) return [];
  const active = Array.from(entries).filter(([, host]) => host.role !== "minion"
    && ["running", "creating", "waiting"].includes(host.status));
  if (active.length) {
    const lookup = createWorkspaceSourceLookup();
    const scoped = active.filter(([, host]) => {
      const project = lookup(host.worktree?.projectPath ?? host.cwd);
      return project !== null && counts.has(project.id);
    });
    for (const [, host] of withoutArchivedWork(scoped, persistenceDb())) {
      const project = lookup(host.worktree?.projectPath ?? host.cwd);
      if (project) counts.set(project.id, (counts.get(project.id) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([projectId, activeSessions]) => ({ projectId, activeSessions }));
}
