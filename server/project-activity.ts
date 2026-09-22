import type { SessionHost } from "./session-host.ts";
import { createWorkspaceSourceLookup } from "./workspace-registry.ts";
import { persistenceDb } from "./session-persist.ts";
import { withoutArchivedWork } from "./session-list-visibility.ts";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";
import { ACTIVE_LEADER_LABELS, projectAgentActivity } from "../shared/project-agent-activity.ts";

/** Read only identity, status and task roster fields, never transcript/detail projections. */
export function projectActivitySummary(
  entries: Iterable<[string, SessionHost]>, projectIds: string[],
): ProjectActivitySummary[] {
  const ids = [...new Set(projectIds)];
  if (!ids.length) return [];
  const visible = withoutArchivedWork(Array.from(entries), persistenceDb());
  const parentKeys = new Set(visible.flatMap(([, host]) =>
    host.role === "minion" && host.parentRunKey ? [host.parentRunKey] : []));
  const lookup = createWorkspaceSourceLookup();
  const sessions = visible.map(([sessionKey, host]) => {
    const activeMinions = host.role === "leader" && host.taskState
      ? Array.from(host.taskState.tasks, ([taskId, task]) => ({
        taskId, status: task.status, sessionKey: task.minionSessionKey,
      })).filter((task) => ["planned", "starting", "running", "blocked"].includes(task.status))
      : [];
    // Retain terminal child statuses to override stale running roster entries.
    // Idle leaders still own executing roster tasks and graph children.
    const needsProject = host.role === "leader"
      ? Object.hasOwn(ACTIVE_LEADER_LABELS, host.status) || activeMinions.length > 0
        || parentKeys.has(host.runKey) || parentKeys.has(sessionKey)
      : host.role === "minion" && ["creating", "starting", "running"].includes(host.status);
    return {
      sessionKey, runKey: host.runKey, parentRunKey: host.parentRunKey,
      role: host.role, status: host.status, activeMinions,
      projectId: needsProject ? lookup(host.worktree?.projectPath ?? host.cwd)?.id : undefined,
    };
  });
  return ids.map((projectId) => {
    const { active, activeCrew } = projectAgentActivity(sessions, (session) => session.projectId === projectId);
    return { projectId, activeLeaders: active.length, activeCrew };
  });
}
