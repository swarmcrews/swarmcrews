import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBus } from "./bus.ts";
import { SessionHost } from "./session-host.ts";
import { buildAgentContext } from "./session-host-agent-context.ts";
import { processNormalizedEvent } from "./session-host-run.ts";
import { consumeProviderInvocation } from "./session-host-provider-loop.ts";
import { createLeaderStateCallbacks } from "./agents/leader-state-callbacks.ts";
import { disablePersistence } from "./session-persist.ts";
import { beginSessionDecisionTurn, pendingSessionDecision } from "./session-decision-wait.ts";
import { queueWorkItemGuidance } from "./work-item-continuation.ts";
import { cancelCoalescedWake, requestCoalescedWake } from "./wake-coalescer.ts";
import { HARNESS_DRAIN } from "./harness/terminal-provenance.ts";
import type { AgentType } from "./agents/types.ts";
import type { SessionHostDeps } from "./session-host-types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const host = new SessionHost("decision-run", "/tmp");
  host.workItemId = "work";
  host.status = "running";
  const deps: SessionHostDeps = {
    bus: createBus({ clients: new Set() } as never), startChildSession: () => {}, forEachLeaderTaskState: () => {},
    workItemLifecycle: { providerInitialized: vi.fn(), runStarted: vi.fn(), runWaiting: vi.fn(), runTerminal: vi.fn() },
  };
  const opts = { sessionKey: host.id, cwd: host.cwd, prompt: "go" };
  const ctx = buildAgentContext(host, opts, deps);
  const agent: AgentType = { id: "default", wantsWorktree: false,
    buildSystemPrompt: () => undefined, getToolGroups: () => ({ toolGroups: {}, mcpToolNames: [] }) };
  const done = () => processNormalizedEvent(host, deps.bus, agent, ctx,
    { kind: "done", reason: "completed" }, deps.workItemLifecycle);
  return { host, deps, opts, ctx, agent, done };
}

beforeEach(() => disablePersistence());

describe("decision waits require halted execution", () => {
  it("records input intent without publishing a wait while the provider is running", () => {
    const f = fixture();
    f.ctx.markDecisionNeeded!("Choose");
    expect(f.host.reviewLifecycle.reviewState).toBe("none");
    expect(f.deps.workItemLifecycle!.runWaiting).not.toHaveBeenCalled();
    f.done();
    expect(f.host.reviewLifecycle.reviewState).toBe("decision_needed");
    expect(f.deps.workItemLifecycle!.runWaiting).toHaveBeenCalledWith(expect.objectContaining({ waitKind: "decision" }));
  });

  it.each(["timer", "crew", "continuation", "guidance", "wake"])("does not promote input intent during %s activity", (activity) => {
    const f = fixture();
    f.ctx.markDecisionNeeded!("Choose");
    if (activity === "timer") f.host.taskState = { tasks: new Map(), approval: null,
      pendingWait: { durationMs: 100, scheduledAt: 1, reason: "automatic wake", timerId: null } };
    if (activity === "crew") f.host.taskState = { tasks: new Map([["child", {
      executor: "minion", minionSessionKey: "child", status: "running",
    } as never]]), approval: null, pendingWait: null };
    if (activity === "continuation") f.agent.onComplete = () => { f.host.status = "running"; };
    if (activity === "guidance") queueWorkItemGuidance(f.host, () => {});
    if (activity === "wake") requestCoalescedWake(f.host, f.deps, { opts: f.opts });
    f.done();
    cancelCoalescedWake(f.host);
    expect(f.host.reviewLifecycle.reviewState).not.toBe("decision_needed");
    expect(f.deps.workItemLifecycle!.runWaiting).not.toHaveBeenCalledWith(expect.objectContaining({ waitKind: "decision" }));
    expect(f.deps.workItemLifecycle!.runTerminal).not.toHaveBeenCalled();
  });

  it("does not retain a decision after the unanswered form was removed", () => {
    const f = fixture();
    const callbacks = createLeaderStateCallbacks(f.ctx, f.host.id);
    const state = { layout: { columns: 2, gap: 12 }, components: [{ id: "choice", type: "form" as const, fields: [] }] };
    f.host.renderState = state;
    callbacks.onRenderStateChange(state);
    state.components = [];
    callbacks.onRenderStateChange(state);
    f.done();
    expect(f.host.reviewLifecycle.reviewState).toBe("completion_to_review");
  });

  it("waits for both the event stream and harness drain before exposing a decision", async () => {
    const f = fixture();
    const stream = deferred();
    const drain = deferred();
    const observedDone = deferred();
    f.host.runControl = { abort() {}, [HARNESS_DRAIN]: drain.promise } as typeof f.host.runControl;
    f.ctx.markDecisionNeeded!("Choose");
    const consumed = consumeProviderInvocation({ ...f, agentType: f.agent, agentCtx: f.ctx,
      abortController: f.host.abortController, events: (async function* () {
        yield { kind: "done" as const, reason: "completed" as const };
        observedDone.resolve();
        await stream.promise;
      })() });
    await observedDone.promise;
    expect(f.host.status).toBe("running");
    expect(f.deps.workItemLifecycle!.runWaiting).not.toHaveBeenCalled();
    stream.resolve();
    await Promise.resolve();
    expect(f.host.reviewLifecycle.reviewState).toBe("none");
    drain.resolve();
    await consumed;
    expect(f.host.reviewLifecycle.reviewState).toBe("decision_needed");
    expect(f.host.runControl).toBeNull();
    expect(f.host.eventStream).toBeNull();
  });

  it.each(["new_run", "resume_open_run", "provider_continuation"] as const)("clears published decision state when %s starts", (kind) => {
    const f = fixture();
    f.ctx.markDecisionNeeded!("Choose");
    f.done();
    expect(f.host.reviewLifecycle.reviewState).toBe("decision_needed");
    beginSessionDecisionTurn(f.host, f.deps.bus, kind);
    expect(f.host.reviewLifecycle.reviewState).toBe("none");
    expect(pendingSessionDecision(f.host)).toBe(kind === "provider_continuation" ? "Choose" : null);
  });

  it("does not turn a provider error into a decision", () => {
    const f = fixture();
    f.ctx.markDecisionNeeded!("Choose");
    processNormalizedEvent(f.host, f.deps.bus, f.agent, f.ctx,
      { kind: "done", reason: "error", error: "failed" }, f.deps.workItemLifecycle);
    expect(f.host.reviewLifecycle.reviewState).toBe("error_to_review");
    expect(f.deps.workItemLifecycle!.runWaiting).not.toHaveBeenCalled();
  });

  it("does not publish a deferred decision after cancellation during drain", async () => {
    const f = fixture();
    const drain = deferred();
    const streamEnded = deferred();
    f.host.runControl = { abort() {}, [HARNESS_DRAIN]: drain.promise } as typeof f.host.runControl;
    f.ctx.markDecisionNeeded!("Choose");
    const consumed = consumeProviderInvocation({ ...f, agentType: f.agent, agentCtx: f.ctx,
      abortController: f.host.abortController, events: (async function* () {
        yield { kind: "done" as const, reason: "completed" as const };
        streamEnded.resolve();
      })() });
    await streamEnded.promise;
    f.host.abortController.abort();
    f.host.status = "stopped";
    drain.resolve();
    await consumed;
    expect(f.host.status).toBe("stopped");
    expect(f.host.reviewLifecycle.reviewState).not.toBe("decision_needed");
    expect(f.deps.workItemLifecycle!.runWaiting).not.toHaveBeenCalled();
  });
});
