import type { WebSocket } from "ws";

/** Connection-local routing; identities are selected by client requests, not broadcast globally. */
interface Subscription { projectId: string | null; sessions: Set<string> }
const subscriptions = new WeakMap<WebSocket, Subscription>();
const sessionProjects = new Map<string, string>();
const workItemProjects = new Map<string, string>();
export const MAX_EXPLICIT_SESSION_SUBSCRIPTIONS = 128;
const MAX_PROJECT_INDEX = 20_000;
function index(map: Map<string, string>, key: string, projectId: string): void {
  map.delete(key);
  map.set(key, projectId);
  if (map.size > MAX_PROJECT_INDEX) map.delete(map.keys().next().value!);
}
export function clearConnectionSubscriptions(ws: WebSocket): void { subscriptions.delete(ws); }

export function setConnectionProject(ws: WebSocket, projectId: string | null): void {
  const previous = subscriptions.get(ws);
  if (previous?.projectId === projectId) return;
  subscriptions.set(ws, { projectId, sessions: new Set() });
}
export function subscribeConnectionSession(ws: WebSocket, key: string): void {
  const current = subscriptions.get(ws) ?? { projectId: null, sessions: new Set<string>() };
  current.sessions.delete(key);
  current.sessions.add(key);
  if (current.sessions.size > MAX_EXPLICIT_SESSION_SUBSCRIPTIONS) current.sessions.delete(current.sessions.values().next().value!);
  subscriptions.set(ws, current);
}
export function indexSessionProjects(sessions: readonly { sessionKey: string; projectId?: string; workItemId?: string | null }[]): void {
  for (const session of sessions) if (session.projectId) {
    index(sessionProjects, session.sessionKey, session.projectId);
    if (session.workItemId) index(workItemProjects, session.workItemId, session.projectId);
  }
}
export function indexProjectEvent(projectId: string, payload: Record<string, unknown>): void {
  const run = payload["run"] as { runKey?: unknown } | undefined;
  const workItem = payload["workItem"] as { id?: unknown } | undefined;
  const workItemId = payload["workItemId"] ?? workItem?.id;
  if (typeof workItemId === "string") index(workItemProjects, workItemId, projectId);
  if (typeof run?.runKey === "string") index(sessionProjects, run.runKey, projectId);
}
export function connectionAccepts(ws: WebSocket, topic: string, payload?: Record<string, unknown>): boolean {
  const subscription = subscriptions.get(ws);
  if (topic === "global") return true;
  // Explicit replies remain available for deep links, new runs, and session discovery.
  // In-process bus rigs have no connection handshake. Production sockets
  // are registered on accept, even before a project has been selected.
  if (!subscription) return true;
  if (topic.startsWith("project:")) return topic.slice(8) === subscription.projectId;
  if (topic.startsWith("session:")) {
    const key = topic.slice(8);
    return subscription.sessions.has(key) || sessionProjects.get(key) === subscription.projectId;
  }
  const projectId = payload?.["projectId"] ?? (payload?.["workItem"] as { projectId?: string } | undefined)?.projectId
    ?? (payload?.["lineage"] as { projectId?: string } | undefined)?.projectId
    ?? (topic.startsWith("work-item:") ? workItemProjects.get(topic.slice(10)) : undefined);
  return typeof projectId === "string" && projectId === subscription.projectId;
}
export function connectionInventory(ws: WebSocket, sessions: readonly { sessionKey: string; projectId?: string }[]) {
  const projectId = subscriptions.get(ws)?.projectId;
  return projectId ? sessions.filter(s => s.projectId === projectId) : [];
}

export function connectionProject(ws: WebSocket): string | null {
  return subscriptions.get(ws)?.projectId ?? null;
}
