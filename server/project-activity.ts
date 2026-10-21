import type { SessionHost } from "./session-host.ts";
import { withLibraryRuntimeEvidence } from "./project-library/runtime.ts";
import { createWorkspaceSourceLookup } from "./workspace-registry.ts";
import { persistenceDb } from "./session-persist.ts";
import { withoutArchivedWork } from "./session-list-visibility.ts";
import type { ProjectActivitySummary } from "../shared/project-activity.ts";
import { ACTIVE_LEADER_LABELS, projectAgentActivity } from "../shared/project-agent-activity.ts";
const KNOWN_HOST_STATUSES = ["creating", "starting", "running", "waiting", "idle", "stopped", "error", "completed", "disconnected"];
const RUNNING_HOST_STATUSES = ["creating", "starting", "running"];

/** Read only identity, status and task roster fields, never transcript/detail projections. */
export function projectActivitySummary(
  entries: Iterable<[string, SessionHost]>, projectIds: string[],
): ProjectActivitySummary[] {
  const ids = [...new Set(projectIds)];
  if (!ids.length) return [];
  const all = Array.from(entries);
  const visible = withoutArchivedWork(all, persistenceDb());
  const visibleKeys = new Set(visible.map(([key]) => key));
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
    const unknownStatus = !KNOWN_HOST_STATUSES.includes(host.status);
    const needsProject = unknownStatus || (host.role === "leader"
      ? Object.hasOwn(ACTIVE_LEADER_LABELS, host.status) || activeMinions.length > 0
        || parentKeys.has(host.runKey) || parentKeys.has(sessionKey)
      : ["creating", "starting", "running", "waiting"].includes(host.status));
    return {
      sessionKey, runKey: host.runKey, parentRunKey: host.parentRunKey,
      role: host.role, status: host.status, activeMinions, unknownStatus, needsProject,
      projectId: needsProject ? lookup(host.worktree?.projectPath ?? host.cwd)?.id : undefined,
    };
  });
  const leaders = sessions.filter(session => session.role === "leader");
  const leaderKeys = new Set(leaders.flatMap(session => [session.sessionKey, session.runKey]));
  const rosterKeys = new Set(leaders.flatMap(session => session.activeMinions.map(task => task.sessionKey)));
  // The legacy crew badge requires a known parent (or roster ownership). A
  // missing parent must not turn a live child into authority-safe zero work.
  const orphanedMinions = new Set(sessions.filter(session => session.role === "minion"
    && session.parentRunKey && !leaderKeys.has(session.parentRunKey)
    && !rosterKeys.has(session.sessionKey)).map(session => session.sessionKey));
  return ids.map((projectId) => {
    const { active, activeCrew } = projectAgentActivity(sessions, (session) => session.projectId === projectId);
    const suppressedActive = all.filter(([key, host]) => !visibleKeys.has(key)
      && (["creating", "starting", "running", "waiting"].includes(host.status)
        || (host.role === "leader" && host.taskState && Array.from(host.taskState.tasks.values()).some(task => ["starting", "running", "blocked"].includes(task.status))))
      && lookup(host.worktree?.projectPath ?? host.cwd)?.id === projectId);
    const activeOther = suppressedActive.length + sessions.filter(session => session.projectId === projectId
      && ((session.role !== "leader" && session.role !== "minion"
        && ["creating", "starting", "running", "waiting"].includes(session.status))
        || (session.role === "minion" && (["waiting"].includes(session.status)
          || (orphanedMinions.has(session.sessionKey) && RUNNING_HOST_STATUSES.includes(session.status)))))).length;
    const known = !sessions.some(session => (session.projectId === projectId || (!session.projectId && session.needsProject))
      && (session.unknownStatus || (!session.projectId && session.needsProject)))
      && !all.some(([key, host]) => !visibleKeys.has(key) && !KNOWN_HOST_STATUSES.includes(host.status)
        && lookup(host.worktree?.projectPath ?? host.cwd)?.id === projectId);
    const archiveBlocked = sessions.some(session => session.projectId === projectId
      && session.activeMinions.some(task => ["planned", "blocked"].includes(task.status)));
    const runningLeaders = active.filter(session => RUNNING_HOST_STATUSES.includes(session.status)).length;
    const runningOther = suppressedActive.filter(([, host]) => RUNNING_HOST_STATUSES.includes(host.status)).length
      + sessions.filter(session => session.projectId === projectId
        && ((session.role !== "leader" && session.role !== "minion") || orphanedMinions.has(session.sessionKey))
        && RUNNING_HOST_STATUSES.includes(session.status)).length;
    return withLibraryRuntimeEvidence({ projectId, activeLeaders: active.length, activeCrew }, activeOther, known, { leaders: runningLeaders, other: runningOther }, archiveBlocked);
  });
}
