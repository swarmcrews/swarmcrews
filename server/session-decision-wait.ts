import { hasActiveGraphExecution } from "./task-graph/work-item-activity.ts";
import type { SessionHost } from "./session-host.ts";
import type { AgentTypeContext } from "./agents/types.ts";
import { findUnansweredForms } from "../shared/render-dsl.ts";
import { beginRun, commitReviewLifecycle } from "./session-review-lifecycle.ts";
import type { SessionInvocationKind } from "./session-host-types.ts";
import { hasQueuedWorkItemGuidance } from "./work-item-continuation.ts";
import type { Bus } from "./bus.ts";
import { getWakeQueueStats } from "./wake-coalescer.ts";
import { getQueuedWaitResume } from "./wait-resume.ts";

// A tool requesting input is intent, not evidence that execution has halted.
// Keep intent separate from the published/persisted review lifecycle.
const requests = new WeakMap<SessionHost, Map<string, () => boolean>>();

export function stageSessionDecision(host: SessionHost, reason: string, isPending = () => true): void {
  const pending = requests.get(host) ?? new Map();
  pending.set(reason, isPending);
  requests.set(host, pending);
}

export function beginSessionDecisionTurn(host: SessionHost, bus: Bus, kind: SessionInvocationKind): void {
  if (kind !== "provider_continuation") requests.delete(host);
  if (kind === "new_run") {
    host.runtimeTerminalNotified = false;
    host.runtimeTerminalInFlight = false;
    host.reviewLifecycle = beginRun(host.reviewLifecycle);
  } else if (host.reviewLifecycle.reviewState === "decision_needed") {
    commitReviewLifecycle(host, bus, beginRun(host.reviewLifecycle));
  }
}

export function pendingSessionDecision(host: SessionHost): string | null {
  for (const [reason, isPending] of requests.get(host) ?? []) {
    if (isPending()) return reason;
  }
  // Dashboard/approval state survives provider continuations and recovery.
  if (host.renderState && findUnansweredForms(host.renderState.components).length) return "Dashboard input requested";
  if (host.taskState?.approval?.requested) return host.taskState.approval.summary || "Review and approve changes";
  return host.reviewLifecycle.reviewState === "decision_needed" ? host.reviewLifecycle.reviewReason ?? "Input requested" : null;
}

export function hasAutomaticDecisionContinuation(host: SessionHost, ctx: AgentTypeContext): boolean {
  if (host.taskState?.pendingWait || host.waitTimerId !== null || getQueuedWaitResume(host)) return true;
  const wakes = getWakeQueueStats(host);
  if (wakes.count || wakes.inFlight || hasQueuedWorkItemGuidance(host)) return true;
  if (pendingSessionDecision(host) && ctx.taskGraphPlanning && host.workItemId) {
    const { plan, runtime } = ctx.taskGraphPlanning.inspection(host.workItemId, host.runKey);
    if (plan?.primaryRunKey === host.runKey && runtime && hasActiveGraphExecution(runtime)) return true;
  }
  for (const task of host.taskState?.tasks.values() ?? []) {
    if (task.executor !== "minion") continue;
    const runtime = task.minionSessionKey ? ctx.getSessionRuntime?.(task.minionSessionKey) : null;
    if (runtime?.isLive || ["starting", "running"].includes(task.status)) return true;
  }
  return false;
}
