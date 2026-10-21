/** Project a completed provider invocation without replaying its completion hooks. */
import type { AgentTypeContext } from "./agents/types.ts";
import type { Bus } from "./bus.ts";
import type { NormalizedEvent } from "./harness/types.ts";
import type { SessionHost } from "./session-host.ts";
import type { WorkItemRuntimeLifecycle } from "./session-host-types.ts";
import type { BufferedEvent } from "./session-host-config.ts";
import { pendingSessionDecision, hasAutomaticDecisionContinuation } from "./session-decision-wait.ts";
import { beginRun, commitReviewLifecycle, finishRun, requestDecision } from "./session-review-lifecycle.ts";
import { notifyRuntimeTerminal } from "./session-host-identity.ts";
import { getRunInvocation, projectRunInvocationSeal, type CleanTerminalSealPolicy } from "./work-item-invocations.ts";
import { persistenceDb } from "./session-persist.ts";
import { watchSessionCompletion } from "./session-completion-reconciliation.ts";

function projectHostInvocation(
  host: SessionHost,
  event: Extract<NormalizedEvent, { kind: "done" }>,
  cleanTerminalPolicy: CleanTerminalSealPolicy,
) {
  const db = persistenceDb();
  const invocation = db && host.providerInvocationGeneration > 0
    ? getRunInvocation(db, host.runKey, host.providerInvocationGeneration)
    : null;
  return projectRunInvocationSeal({
    terminalKind: invocation?.terminal_kind
      ?? (event.reason === "error" ? "error"
        : event.reason === "abort" ? "cancelled" : "clean"),
    terminalSource: invocation?.terminal_source ?? "adapter",
    terminationIntent: invocation?.termination_intent ?? null,
    cleanTerminalPolicy,
  });
}

export function projectSessionCompletion(
  host: SessionHost, bus: Bus, agentCtx: AgentTypeContext,
  event: Extract<NormalizedEvent, { kind: "done" }>,
  runtimeLifecycle?: WorkItemRuntimeLifecycle,
): void {
  const now = Date.now();
  let blocked = false;
  let durableTask: { status: string; result: string | null; taskId: string } | null = null;
  let durableLeaderKey: string | null = null;
  agentCtx.forEachLeaderTaskState?.((leaderKey, state) => {
    const task = [...state.tasks.values()].find((candidate) => candidate.minionSessionKey === host.id);
    if (!task) return;
    if (task.status === "blocked") blocked = true;
    durableTask = task;
    durableLeaderKey = leaderKey;
  });
  const decision = pendingSessionDecision(host);
  const waitKind = (host.status as string) === "running" ? "continuation"
    : host.taskState?.pendingWait || host.waitTimerId !== null ? "timer"
    : hasAutomaticDecisionContinuation(host, agentCtx) ? "continuation"
    : blocked ? "blocked"
    : decision ? "decision" : null;
  const projection = projectHostInvocation(host, event, waitKind ? "continue" : "seal");
  if (projection.action === "continue") {
    if (host.role === "leader" && waitKind === "continuation" && host.status === "idle") {
      watchSessionCompletion(host, bus,
        () => !hasAutomaticDecisionContinuation(host, agentCtx),
        () => projectSessionCompletion(host, bus, agentCtx, event, runtimeLifecycle));
    }
    if (waitKind === "decision") {
      commitReviewLifecycle(host, bus, requestDecision(host.reviewLifecycle, decision!), now);
    } else if (host.reviewLifecycle.reviewState === "decision_needed") {
      commitReviewLifecycle(host, bus, beginRun(host.reviewLifecycle), now);
    }
    if (host.workItemId && waitKind) runtimeLifecycle?.runWaiting({
      workItemId: host.workItemId, runKey: host.runKey, runKind: host.runKind,
      parentRunKey: host.parentRunKey, taskId: host.taskId, waitKind, at: now,
    });
    if ((host.status as string) !== "running") {
      host.status = "idle";
      const idle: BufferedEvent = { type: "session_status", sessionKey: host.id, status: "idle", sessionId: host.sessionId ?? undefined, timestamp: now };
      host.bufferEvent(idle);
      bus.emitToSession(host.id, idle);
    }
  } else {
    agentCtx.cleanupLiveEditRun?.(host.runKey);
    const normalizedReason = !host.workItemId ? event.reason
      : projection.outcome === "completed" ? "completed"
        : projection.outcome === "error" ? "error"
          : projection.outcome === "stopped" ? "stop" : "abort";
    commitReviewLifecycle(host, bus, finishRun(host.reviewLifecycle, {
      reason: normalizedReason,
      report: event.reason === "error" ? event.error : event.result,
      at: now,
    }), now);
    const payload: BufferedEvent = projection.outcome === "error"
      ? { type: "session_error", sessionKey: host.id, error: host.lastError ?? "unknown", fullError: host.lastErrorFull ?? undefined, timestamp: now }
      : { type: "session_status", sessionKey: host.id, status: "idle", sessionId: host.sessionId ?? undefined, timestamp: now };
    host.bufferEvent(payload);
    bus.emitToSession(host.id, payload);
    if (host.workItemId) {
      const durable = durableTask as { status: string; result: string | null; taskId: string } | null;
      const taskReport = durable?.result?.trim() || null;
      const eventReport = event.result?.trim() || null;
      // Reports annotate but never determine the ledger projection.
      const durableReport = host.runKind === "child" ? taskReport : null;
      const finalReport = durableReport ?? eventReport;
      const finalReportId = durableReport && durableLeaderKey
        ? `task:${durableLeaderKey}:${durable!.taskId}:report`
        : finalReport ? `${host.runKey}:final-report` : null;
      notifyRuntimeTerminal(host, runtimeLifecycle, {
        outcome: projection.outcome,
        finalReportId, finalReport, at: now,
      });
    }
  }
}
