export const ACTIVE_LEADER_LABELS: Record<string, string> = {
  running: "Working",
  creating: "Starting",
  starting: "Starting",
  waiting: "Waiting",
};

const EXECUTING_CREW_STATUSES = new Set(["creating", "starting", "running"]);

export interface ProjectAgentSession {
  sessionKey: string;
  runKey?: string;
  parentRunKey?: string | null;
  role?: string;
  status: string;
  activeMinions?: Array<{ taskId: string; status: string; sessionKey: string | null }>;
}

/** Shared by the live switcher and the lightweight project summary endpoint. */
export function projectAgentActivity<T extends ProjectAgentSession>(
  sessions: T[], belongsToProject: (session: T) => boolean,
): { active: T[]; activeCrew: number } {
  const leaders = sessions.filter((session) => session.role === "leader" && belongsToProject(session));
  const active = leaders.filter((session) => Object.hasOwn(ACTIVE_LEADER_LABELS, session.status));
  const leaderKeys = new Set(leaders.flatMap((leader) => [leader.sessionKey, leader.runKey ?? leader.sessionKey]));
  const sessionsByKey = new Map(sessions.map((session) => [session.sessionKey, session]));
  const crew = new Set<string>();
  for (const leader of leaders) {
    for (const minion of leader.activeMinions ?? []) {
      const live = minion.sessionKey ? sessionsByKey.get(minion.sessionKey) : undefined;
      if (EXECUTING_CREW_STATUSES.has(live?.status ?? minion.status)) {
        crew.add(minion.sessionKey ?? `${leader.sessionKey}:${minion.taskId}`);
      }
    }
  }
  // Graph children can arrive before the leader's task roster is updated.
  for (const session of sessions) {
    if (session.role === "minion" && EXECUTING_CREW_STATUSES.has(session.status) &&
      (session.parentRunKey ? leaderKeys.has(session.parentRunKey) : belongsToProject(session))) {
      crew.add(session.sessionKey);
    }
  }
  return { active, activeCrew: crew.size };
}
