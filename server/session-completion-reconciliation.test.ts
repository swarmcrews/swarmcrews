import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBus } from "./bus.ts";
import { SessionHost } from "./session-host.ts";
import { processNormalizedEvent } from "./session-host-run.ts";
import { disablePersistence, openPersistDb } from "./session-persist.ts";
import { createSqliteWorkItemService } from "./work-item-service-sqlite.ts";
import { createWorkItemRuntimeLifecycle } from "./work-item-runtime-lifecycle.ts";
import { persistInvocationBeforeHarnessOpen } from "./work-item-run-start.ts";
import { getRunInvocation } from "./work-item-invocations.ts";
import { selectWorkItemPresentation } from "../shared/work-item-lifecycle.ts";
import { beginSessionDecisionTurn, pendingSessionDecision, stageSessionDecision } from "./session-decision-wait.ts";
import type { AgentType, AgentTypeContext } from "./agents/types.ts";
import type { WorkItemRuntimeLifecycle } from "./session-host-types.ts";
import type { TaskRecord } from "./task-tools/types.ts";
import { watchSessionCompletion } from "./session-completion-reconciliation.ts";
import { queueWorkItemGuidance } from "./work-item-continuation.ts";
import { initDb } from "./db.ts";
import { ensureWorkItemSchema } from "./work-item-schema.ts";
import { createWorkItem, startWorkItemIteration } from "./work-item-repo.ts";
import { TaskGraphService } from "./task-graph/service.ts";
import { TaskGraphPlanningCoordinator } from "./task-graph/planning-coordinator.ts";
import { semanticTaskGraphPlanSchema } from "../shared/task-graph-planning-contracts.ts";

function fixture() {
  const bus = createBus({ clients: new Set() } as never);
  const host = new SessionHost("leader", "/repo");
  host.workItemId = "work";
  host.role = "leader";
  host.status = "running";
  const live = new Set(["child-a", "child-b"]);
  host.taskState = { tasks: new Map([...live].map(key => [key, {
    taskId: key, executor: "minion", minionSessionKey: key,
    status: "completed", result: "Reported", attentionDeliveredAt: 1,
  } as TaskRecord])), pendingWait: null, approval: null };
  const hooks: WorkItemRuntimeLifecycle = {
    providerInitialized: vi.fn(), runStarted: vi.fn(), runWaiting: vi.fn(), runTerminal: vi.fn(),
  };
  const agent: AgentType = { id: "leader", wantsWorktree: false,
    buildSystemPrompt: () => undefined,
    getToolGroups: () => ({ toolGroups: {}, mcpToolNames: [] }), onComplete: vi.fn() };
  const ctx = { sessionKey: host.id, bus,
    getSessionRuntime: (key: string) => ({ isLive: live.has(key) }),
    cleanupLiveEditRun: vi.fn(),
  } as unknown as AgentTypeContext;
  const done = () => processNormalizedEvent(host, bus, agent, ctx,
    { kind: "done", reason: "completed", result: "Leader final report" }, hooks);
  const endChild = async (key: string) => {
    live.delete(key);
    bus.emitToSession(key, { type: "session_status", sessionKey: key, status: "idle" });
    await Promise.resolve();
  };
  return { host, bus, hooks, agent, ctx, done, endChild };
}

async function graphFixture() {
  const f = fixture();
  const db = initDb(":memory:");
  ensureWorkItemSchema(db);
  createWorkItem(db, { id: "work", projectId: "project", projectPath: "/repo",
    title: "Cooldown", changeMode: "live", at: 1 });
  startWorkItemIteration(db, { workItemId: "work", runKey: f.host.runKey,
    idempotencyKey: "start", expectedLifecycleRevision: 0, expectedCurrentRunKey: null, at: 2 });
  let now = 10;
  const service = new TaskGraphService({ db, bus: f.bus, now: () => now,
    availableDispatchSlots: () => 0,
    children: { startChildRun: async () => { throw new Error("Manual scheduler fixture must not dispatch"); } } });
  const hash = `sha256:${"a".repeat(64)}`;
  const coordinator = new TaskGraphPlanningCoordinator({ db, bus: f.bus, taskGraphs: service,
    now: () => now,
    resolveSourceAuthority: () => ({ workspaceId: "workspace", cwd: "/repo", projectPath: "/repo",
      worktreeIdentity: "primary", connectedContext: "", skillIds: [], skillValues: {},
      harnessName: "codex", allowedTools: [] }),
    // Repository/source capture is the filesystem boundary; all planning,
    // scheduling, dependency deadlines and inspection below use real modules.
    captureSource: async input => ({ fingerprint: hash, policyAllowsAutoStart: true,
      startBlockedReason: null, reviewRequirements: [], scopedSources: [], snapshot: {
        id: `source-${input.revisionId}`, workItemId: input.workItemId, primaryRunKey: input.primaryRunKey,
        taskGraphRevisionId: input.revisionId, repositoryBaseCommit: "abc", dirtyDiffDigest: hash,
        workspaceId: "workspace", worktreeIdentity: "primary", systemModelDigest: hash,
        workPacketRevisionId: null, connectedContext: [], compiledSkills: [],
        harnessPolicyDigest: hash, toolPolicyDigest: hash, createdAt: now,
      } }),
  });
  f.ctx.taskGraphPlanning = coordinator;
  const plan = await coordinator.submit({ workItemId: "work", primaryRunKey: f.host.runKey,
    mode: "auto", requestId: "plan", baseProposalRevision: null,
    plan: semanticTaskGraphPlanSchema.parse({ objective: "Finish after cooldown", acceptanceCriteria: ["done"],
      steps: [{ key: "a", title: "A", objective: "A", acceptanceCriteria: ["done"] },
        { key: "b", title: "B", objective: "B", acceptanceCriteria: ["done"],
          dependsOn: [{ stepKey: "a", delayMs: 300_000 }] }] }) });
  const runId = plan.graphRunId!;
  const admit = () => {
    const fencingToken = service.scheduler.acquireLease(runId, service.ownerId, now, 1_000_000);
    return service.scheduler.schedule({ runId, expectedRunRevision: service.snapshot(runId).run.revision,
      ownerId: service.ownerId, fencingToken, now });
  };
  const finish = async (attempt: ReturnType<typeof admit>[number]) => {
    service.scheduler.terminal({ runId, attemptId: attempt.attemptId, generation: attempt.generation,
      actorSessionKey: "test", idempotencyKey: `done:${attempt.attemptId}`,
      expectedRunRevision: service.snapshot(runId).run.revision, at: now }, "succeeded", {});
    await service.tick(runId);
  };
  return { ...f, service, coordinator, runId, admit, finish, setNow: (value: number) => { now = value; },
    dispose: () => { f.host.abortController.abort(); coordinator.dispose(); service.dispose(); db.close(); } };
}

beforeEach(() => disablePersistence());
afterEach(() => disablePersistence());

describe("completion after reported children finish", () => {
  it.each(["running", "quiescent"])("keeps a %s graph open across child drain and seals only after delayed work completes", async status => {
    const f = await graphFixture();
    try {
      const [a] = f.admit();
      if (status === "quiescent") { f.setNow(20); await f.finish(a!); }
      expect(f.coordinator.inspection("work", f.host.runKey).runtime?.status).toBe(status);
      expect(pendingSessionDecision(f.host)).toBeNull();
      expect(f.host.taskState?.pendingWait).toBeNull();
      expect(f.host.waitTimerId).toBeNull();
      f.done();
      await f.endChild("child-a");
      await f.endChild("child-b");
      expect(f.hooks.runTerminal).not.toHaveBeenCalled();
      if (status === "running") { f.setNow(20); await f.finish(a!); }
      expect(f.service.viewSnapshot(f.runId).nodes.find(node => node.scheduledReleaseAt))
        .toMatchObject({ currentAttempt: null });
      f.setNow(300_019);
      expect(f.admit()).toEqual([]);
      expect(f.service.viewSnapshot(f.runId).nodes.some(node => node.scheduledReleaseAt)).toBe(true);
      expect(f.hooks.runTerminal).not.toHaveBeenCalled();
      f.setNow(300_020);
      const [b] = f.admit();
      expect(b).toBeDefined();
      await f.finish(b!);
      await Promise.resolve();
      expect(f.service.viewSnapshot(f.runId).status).toBe("completed");
      expect(f.hooks.runTerminal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        outcome: "completed", finalReport: "Leader final report",
      }));
      expect(f.agent.onComplete).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it("keeps graph-only automatic activity open even when no children remain at provider completion", async () => {
    const f = await graphFixture();
    try {
      await f.endChild("child-a"); await f.endChild("child-b");
      f.done();
      await Promise.resolve();
      expect(f.hooks.runTerminal).not.toHaveBeenCalled();
      expect(f.hooks.runWaiting).toHaveBeenCalledWith(expect.objectContaining({ waitKind: "continuation" }));
    } finally { f.dispose(); }
  });

  it.each(["abort", "generation", "controller", "terminal"])("honors the %s fence when a cooldown graph eventually completes", async fence => {
    const f = await graphFixture();
    try {
      const [a] = f.admit();
      f.setNow(20); await f.finish(a!);
      f.done();
      await f.endChild("child-a"); await f.endChild("child-b");
      expect(f.hooks.runTerminal).not.toHaveBeenCalled();
      if (fence === "abort") f.host.abortController.abort();
      else if (fence === "generation") f.host.providerInvocationGeneration += 1;
      else if (fence === "controller") f.host.abortController = new AbortController();
      else f.host.runtimeTerminalNotified = true;
      f.setNow(300_020);
      await f.finish(f.admit()[0]!);
      await Promise.resolve();
      expect(f.service.viewSnapshot(f.runId).status).toBe("completed");
      expect(f.hooks.runTerminal).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });

  it("does not let active graph work override error completion", async () => {
    const f = await graphFixture();
    try {
      processNormalizedEvent(f.host, f.bus, f.agent, f.ctx,
        { kind: "done", reason: "error", error: "failed" }, f.hooks);
      expect(f.hooks.runTerminal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        outcome: "error",
      }));
      await f.endChild("child-a"); await f.endChild("child-b");
      expect(f.hooks.runTerminal).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });

  it("seals an idle leader after the last live child ends, preserving its report exactly once", async () => {
    const f = fixture();
    f.done();
    expect(f.hooks.runWaiting).toHaveBeenCalledWith(expect.objectContaining({ waitKind: "continuation" }));
    expect(f.hooks.runTerminal).not.toHaveBeenCalled();
    await f.endChild("child-a");
    expect(f.hooks.runTerminal).not.toHaveBeenCalled();
    await f.endChild("child-b");
    expect(f.hooks.runTerminal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: "completed", finalReport: "Leader final report", finalReportId: "leader:final-report",
    }));
    expect(f.host.reviewLifecycle.reviewState).toBe("completion_to_review");
    expect(f.agent.onComplete).toHaveBeenCalledOnce();
    expect(f.ctx.cleanupLiveEditRun).toHaveBeenCalledOnce();
    await f.endChild("child-b");
    expect(f.hooks.runTerminal).toHaveBeenCalledOnce();
  });

  it("persists and publishes completion without reclaiming the terminal invocation witness", async () => {
    const f = fixture();
    const db = openPersistDb(":memory:");
    const events: Array<Record<string, unknown>> = [];
    f.bus.subscribe(event => events.push(event));
    const service = createSqliteWorkItemService({ db, bus: f.bus,
      generateKey: (kind, id) => kind === "run" ? f.host.id : `${kind}-${id}`,
      launchRun: vi.fn(), continueRun: vi.fn() });
    const draft = await service.create({ requestId: "create", projectId: "p",
      projectPath: "/repo", title: "T", changeMode: "live" });
    f.host.workItemId = draft.workItem.id;
    await service.startRun({ requestId: "start", workItemId: draft.workItem.id,
      prompt: "go", expectedLifecycleRevision: 0, expectedCurrentRunKey: null });
    Object.assign(f.hooks, createWorkItemRuntimeLifecycle({ db, bus: f.bus, service }));
    persistInvocationBeforeHarnessOpen(f.host);
    processNormalizedEvent(f.host, f.bus, f.agent, f.ctx,
      { kind: "init", sessionId: "provider", model: "m" }, f.hooks);
    f.done();
    const witness = getRunInvocation(db, f.host.runKey, f.host.providerInvocationGeneration);
    expect(witness?.terminal_kind).toBe("clean");
    expect(service.getSync(draft.workItem.id)?.workItem.lifecycle.runtimeState).toBe("waiting");
    await f.endChild("child-a");
    await f.endChild("child-b");
    const item = service.getSync(draft.workItem.id)!.workItem;
    expect(item.lifecycle).toMatchObject({ runtimeState: "inactive", outcome: "completed" });
    expect(selectWorkItemPresentation(item.lifecycle).label).toBe("Ready for review");
    expect(events.filter(event => event.type === "work_item_changed").at(-1)?.workItem).toMatchObject({
      lifecycle: { runtimeState: "inactive", outcome: "completed" },
    });
    expect(getRunInvocation(db, f.host.runKey, f.host.providerInvocationGeneration)).toEqual(witness);
    expect(f.agent.onComplete).toHaveBeenCalledOnce();
  });

  it("exposes pending input rather than sealing once crew activity ends", async () => {
    const f = fixture();
    stageSessionDecision(f.host, "Choose");
    f.done();
    await f.endChild("child-a");
    await f.endChild("child-b");
    expect(f.hooks.runTerminal).not.toHaveBeenCalled();
    expect(f.hooks.runWaiting).toHaveBeenLastCalledWith(expect.objectContaining({ waitKind: "decision" }));
    expect(f.host.reviewLifecycle.reviewState).toBe("decision_needed");
  });

  it("observes guidance queued by another child-completion subscriber before sealing", async () => {
    const f = fixture();
    f.done();
    await f.endChild("child-a");
    f.bus.subscribe(event => {
      if (event.type === "session_status" && event["sessionKey"] === "child-b") {
        queueWorkItemGuidance(f.host, () => {});
      }
    });
    await f.endChild("child-b");
    expect(f.hooks.runTerminal).not.toHaveBeenCalled();
    f.host.abortController.abort();
  });

  it("rechecks graph activity only on lifecycle changes for the same work item", async () => {
    const f = fixture();
    f.host.status = "idle";
    let ready = false;
    const complete = vi.fn();
    watchSessionCompletion(f.host, f.bus, () => ready, complete);
    await Promise.resolve();
    ready = true;
    f.bus.emitToWorkItem!("other", { type: "task_graph_changed", workItemId: "other" });
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    f.bus.emitToWorkItem!("work", { type: "task_graph_changed", workItemId: "work" });
    await Promise.resolve();
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each(["new turn", "generation", "controller", "terminal", "error", "stop", "timer"])("does not seal over a %s", async (change) => {
    const f = fixture();
    f.done();
    if (change === "new turn") {
      f.host.providerInvocationGeneration += 1;
      beginSessionDecisionTurn(f.host, f.bus, "resume_open_run");
      f.host.status = "running";
    } else if (change === "generation") {
      f.host.providerInvocationGeneration += 1;
    } else if (change === "controller") {
      f.host.abortController = new AbortController();
    } else if (change === "terminal") {
      f.host.runtimeTerminalNotified = true;
    } else if (change === "error") {
      f.host.status = "error";
    } else if (change === "stop") {
      f.host.abortController.abort();
      f.host.status = "stopped";
    } else {
      f.host.taskState!.pendingWait = { durationMs: 100, scheduledAt: 1, reason: "wait", timerId: null };
    }
    await f.endChild("child-a");
    await f.endChild("child-b");
    expect(f.hooks.runTerminal).not.toHaveBeenCalled();
    f.host.abortController.abort();
  });
});
