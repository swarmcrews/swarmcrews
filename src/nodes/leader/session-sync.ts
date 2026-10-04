import { useEffect, useState, type MutableRefObject } from "react";
import { sessionTopic } from "../../../shared/ws-envelope.ts";
import { subscribeSocketTopic, type ServerMessage, type SocketSubscribe } from "../../use-socket.ts";
import type { PermissionMode } from "../../components/SessionToolbar.tsx";
import type { LeaderData, TaskPlanItem } from "./types.ts";
import { selectCanvasChangeMode } from "./work-item.ts";

export interface RecordedRunConfiguration {
  sessionKey: string;
  model: string | null;
  harness: string | null;
  permissionMode: PermissionMode | null;
}

type SyncResponse = Extract<ServerMessage, { type: "sync_response" }>;
const PERMISSION_MODES: readonly PermissionMode[] = ["auto", "bypassPermissions", "default", "plan", "acceptEdits"];

/** Node-only recovery fields. Never infer run configuration from a harness or project default. */
export function hydrateLeaderSessionSync(current: LeaderData, message: SyncResponse): LeaderData {
  const workItemId = current.workItemId ?? current.workItemSnapshot?.id;
  if (!current.sessionKey || !message.found || message.sessionKey !== current.sessionKey
    || (current.currentRunKey && current.currentRunKey !== current.sessionKey)
    || (message.runKey && message.runKey !== current.sessionKey)
    || (message.workItemId && workItemId && message.workItemId !== workItemId)) return current;
  // Use the same full-snapshot replay fence as the stream reducer: old recovery
  // evidence must not roll run configuration back while the live stream advances.
  if (message.afterHistoryId === undefined && message.history && message.history.highWater > 0
    && message.history.highWater < Math.max(current.historyHighWater ?? 0, current.highestLiveHistoryId ?? 0)
    && !message.history.reset) return current;

  const patch: Partial<LeaderData> = {};
  if (typeof message.model === "string" && message.model.trim()) patch.model = message.model;
  if (typeof message.harness === "string" && message.harness.trim()) patch.harness = message.harness;
  if (PERMISSION_MODES.includes(message.permissionMode as PermissionMode)) {
    patch.permissionMode = message.permissionMode as PermissionMode;
  }
  // Missing/null facts are not permission to synthesize a model or posture.
  // Keep launch settings separate from the recorded display configuration.
  if (message.worktree) {
    patch.worktreePath = message.worktree.path;
    patch.worktreeBranch = message.worktree.branch;
    patch.worktreeStatus = "active";
  }
  if (message.taskName) patch.taskName = message.taskName;
  if (message.lastErrorFull !== undefined) patch.fullError = message.lastErrorFull ?? null;
  if (message.sandboxPolicy) {
    patch.sandboxPolicy = message.sandboxPolicy.requested;
    patch.effectiveSandboxPolicy = message.sandboxPolicy;
  }
  if (Array.isArray(message.taskPlan)) {
    const existingMap = new Map(current.taskPlan.map(task => [task.taskId, task]));
    patch.taskPlan = message.taskPlan.map(task => {
      const existing = existingMap.get(task.taskId);
      return {
        ...task,
        status: task.status as TaskPlanItem["status"],
        cost: existing?.cost ?? 0,
        sessionSummary: existing?.sessionSummary ?? "",
        activeStep: task.status === "running" || task.status === "starting" ? existing?.activeStep ?? null : null,
        progress: existing?.progress ?? [],
      };
    });
  }
  if (message.approval?.requested && selectCanvasChangeMode(current) === "worktree") {
    patch.approvalPending = true;
    patch.approvalSummary = message.approval.summary ?? null;
    patch.approvalDiff = message.approval.diff as LeaderData["approvalDiff"] ?? null;
  } else {
    patch.approvalPending = false;
  }
  return { ...current, ...patch };
}

/** Provenance is run-local: absent fields retain only previously recorded facts from this exact run. */
export function recordRunConfiguration(message: SyncResponse, previous: RecordedRunConfiguration | null): RecordedRunConfiguration {
  if (!message.found) return previous ?? { sessionKey: message.sessionKey, model: null, harness: null, permissionMode: null };
  const prior = previous?.sessionKey === message.sessionKey ? previous : null;
  const fact = (value: string | null | undefined, old: string | null | undefined) =>
    value === undefined ? old ?? null : typeof value === "string" && value.trim() ? value : null;
  return {
    sessionKey: message.sessionKey,
    model: fact(message.model, prior?.model),
    harness: fact(message.harness, prior?.harness),
    permissionMode: message.permissionMode === undefined ? prior?.permissionMode ?? null
      : PERMISSION_MODES.includes(message.permissionMode as PermissionMode) ? message.permissionMode as PermissionMode : null,
  };
}

/** Attach before useSessionStream requests its snapshot, including synchronous boundary replies. */
export function useLeaderSessionSync({ sessionKey, dataRef, emitUpdate, socketSubscribe }: {
  sessionKey: string | null;
  dataRef: MutableRefObject<LeaderData>;
  emitUpdate: (next: LeaderData) => void;
  socketSubscribe?: SocketSubscribe | ((fn: (message: unknown) => void) => () => void) | undefined;
}): RecordedRunConfiguration | null {
  const [configuration, setConfiguration] = useState<RecordedRunConfiguration | null>(null);
  useEffect(() => {
    if (!sessionKey || !socketSubscribe) return;
    return subscribeSocketTopic(socketSubscribe, sessionTopic(sessionKey), message => {
      const msg = message as ServerMessage;
      if (msg.type !== "sync_response") return;
      const current = dataRef.current;
      const next = hydrateLeaderSessionSync(current, msg);
      if (next !== current) {
        setConfiguration(previous => recordRunConfiguration(msg, previous));
        emitUpdate(next);
      }
    });
  }, [sessionKey, dataRef, emitUpdate, socketSubscribe]);
  return configuration?.sessionKey === sessionKey ? configuration : null;
}
