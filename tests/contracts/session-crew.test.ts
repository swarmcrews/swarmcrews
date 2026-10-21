// @vitest-environment jsdom
import "../setup-dom.ts";
import { createElement, useState } from "react";
import { act, fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import { ActivityView } from "../../src/ActivityView.tsx";
import { LeaderNodeRenderer } from "../../src/nodes/LeaderNode.tsx";
import { LEADER_DEFAULT_DATA, type LeaderData } from "../../src/nodes/leader/types.ts";
import { SessionChatScreen } from "../../src/mobile/SessionChatScreen.tsx";
import type { ServerMessage, SocketSubscribe } from "../../src/use-socket.ts";
import type { CanvasNode } from "../../src/types.ts";
import { getToolApprovals, respondToolApproval } from "../../server/commands/respond-tool-approval.ts";
import { SessionHost } from "../../server/session-host.ts";
import { connectionAccepts, setConnectionProject, clearConnectionSubscriptions } from "../../server/session-subscriptions.ts";
import { createChildWorkItemRun } from "../../server/work-item-child-repo.ts";
import { sessionCrewInvalidatedEnvelopeSchema } from "../../shared/ws-envelope.ts";
import { sessionApprovalChildren } from "../../server/session-crew.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setup, cmd } from "../support/server-command-harness.ts";
import { openPersistDb, closePersistDb } from "../../server/session-persist.ts";
import { createWorkItem, startWorkItemIteration } from "../../server/work-item-repo.ts";
import { SqliteWorkItemService } from "../../server/work-item-service-sqlite.ts";
import { TaskGraphService } from "../../server/task-graph/service.ts";
import { syncSession } from "../../server/commands/sync-session.ts";
import type { GraphRevisionInput, SourceSnapshot } from "../../shared/task-graph-contracts.ts";

// Real leased graph dispatch -> child service -> durable session; no task-tool roster.
async function graphCrewFixture(dispatch = true) {
  const h = setup({ sessionKey: "primary", cwd: process.cwd() });
  const db = openPersistDb(":memory:");
  createWorkItem(db, { id: "work", projectId: "project", projectPath: process.cwd(), title: "Work", changeMode: "live", at: 1 });
  startWorkItemIteration(db, { workItemId: "work", runKey: "primary", idempotencyKey: "primary", expectedLifecycleRevision: 0, expectedCurrentRunKey: null, at: 2 });
  h.host.workItemId = "work";
  h.host.role = "leader";
  const children = new SqliteWorkItemService({ db, bus: h.ctx.bus, generateKey: (_kind, id) => id,
    launchRun: () => {}, continueRun: () => {}, now: () => 10 });
  const graph = new TaskGraphService({ db, bus: h.ctx.bus, children, now: () => 10, pollIntervalMs: 0 });
  const spec: GraphRevisionInput = { definitionId: "definition", revisionId: "revision", workItemId: "work", workspaceId: "project",
    objective: "Ship", acceptanceCriteria: ["done"], nonGoals: [], constraints: [], terminalNodeIds: ["node"], maxActiveAttempts: 2, edges: [],
    nodes: [{ id: "node", title: "Graph child", objective: "Do it", inputBindings: {}, outputSchemas: {}, constraints: [], acceptanceCriteria: ["done"],
      executorClass: "standard", allowedHarnesses: ["codex"], allowedTools: [], ownershipRequest: [], budgetRequest: {}, timeoutMs: 30_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 0, retryableOutcomes: ["failed"], jitterMs: 0 }, verificationRequired: false, failurePolicy: "fail_graph", expansionPolicy: null }] };
  const hash = `sha256:${"a".repeat(64)}`;
  const source: SourceSnapshot = { id: "source", workItemId: "work", primaryRunKey: "primary", taskGraphRevisionId: "revision", repositoryBaseCommit: "abc",
    dirtyDiffDigest: hash, workspaceId: "project", worktreeIdentity: "wt", systemModelDigest: hash, workPacketRevisionId: null, connectedContext: [], compiledSkills: [], harnessPolicyDigest: hash, toolPolicyDigest: hash, createdAt: 2 };
  graph.createRevision(spec, 3);
  const start = () => graph.startRun({ id: "graph", workItemId: "work", primaryRunKey: "primary", revisionId: "revision", sourceSnapshot: source, expectedLifecycleRevision: 1, at: 4 });
  if (dispatch) await start();
  return { ...h, db, graph, children, start };
}

function bridge(h: Awaited<ReturnType<typeof graphCrewFixture>>) {
  const listeners = new Set<{ topic: string; fn: (msg: ServerMessage) => void }>();
  const queue: Record<string, unknown>[] = [];
  const sent: Record<string, unknown>[] = [];
  const deliver = (raw: unknown) => {
    const msg = raw as ServerMessage & { topic?: string };
    for (const listener of [...listeners]) if (!msg.topic || listener.topic === "*" || listener.topic === msg.topic) listener.fn(msg);
  };
  const subscribe = Object.assign(((topic: string, fn: (msg: ServerMessage) => void) => {
    const listener = typeof topic === "function" ? { topic: "*", fn: topic } : { topic, fn };
    listeners.add(listener); return () => listeners.delete(listener);
  }) as SocketSubscribe, { supportsTopics: true as const });
  const send = (message: unknown) => { const command = message as Record<string, unknown>; sent.push(command); queue.push(command); };
  h.ws.send = ((raw: string, callback?: () => void) => { const msg = JSON.parse(raw); h.wsSent.push(msg); deliver(msg); callback?.(); }) as typeof h.ws.send;
  // Use production connection routing, not a firehose: parent sync must subscribe
  // the allocated child before the launch boundary creates its volatile host.
  Object.assign(h.ws, { bufferedAmount: 0, once: () => h.ws, off: () => h.ws });
  setConnectionProject(h.ws, null);
  const stop = h.ctx.bus.subscribe(envelope => { if (connectionAccepts(h.ws, envelope.topic, envelope)) deliver(envelope); });
  async function flush() {
    for (let guard = 0; queue.length; guard++) {
      if (guard > 30) throw new Error("unbounded command loop");
      await act(async () => {
        for (const command of queue.splice(0)) {
          const input = cmd(command as Parameters<typeof cmd>[0]);
          if (input.type === "sync_session") syncSession(h.ctx, input, h.ws);
          if (input.type === "get_tool_approvals") getToolApprovals(h.ctx, input, h.ws);
          if (input.type === "respond_tool_approval") respondToolApproval(h.ctx, input, h.ws);
        }
      });
    }
  }
  return { send, subscribe, deliver, sent, flush, stop };
}
const noop = () => {};
function CanvasCrew({ socket }: { socket: ReturnType<typeof bridge> }) {
  const [data, setData] = useState<LeaderData>({ ...LEADER_DEFAULT_DATA, sessionKey: "primary", workItemId: "work", currentRunKey: "primary", status: "running", taskPlan: [] });
  const node: CanvasNode = { id: "leader", type: "leader", position: { x: 0, y: 0 }, size: { width: 480, height: 400 }, data };
  return createElement(LeaderNodeRenderer, { node, projectId: "project", projectPath: process.cwd(), isSelected: false,
    onUpdateData: next => setData(next as LeaderData), socketSend: socket.send, socketSubscribe: socket.subscribe });
}
afterEach(() => { cleanup(); closePersistDb(); vi.restoreAllMocks(); });

describe("canonical graph-only approvals across crew surfaces", () => {
  it.each(["Activity", "Canvas inline", "Canvas fullscreen", "mobile"])("%s: real live dispatch, reconnect, retry, expiry and superseded parent", async surface => {
    const h = await graphCrewFixture(false);
    const socket = bridge(h);
    const prompts = new Map<string, Promise<string>>();
    h.children.options.launchRun = async input => {
      // Force the allocation notification and sync to happen BEFORE host launch.
      await socket.flush();
      const child = new SessionHost(input.runKey, process.cwd());
      child.workItemId = input.workItemId;
      child.seedRunLineage({ runKind: "child", parentRunKey: input.parentRunKey!, taskId: input.taskId! });
      (h.ctx.registry as unknown as { map: Map<string, SessionHost> }).map.set(child.id, child);
      expect(connectionAccepts(h.ws, `session:${child.id}`)).toBe(true);
      const ask = child.toolApprovals.begin(child.abortController.signal, event => h.ctx.bus.emitToSession(child.id, { ...event }));
      prompts.set(child.id, ask({ tool: "Graph command", input: { command: "pwd" } }));
    };
    try {
      const session = h.ctx.registry.snapshot()[0]!;
      expect(session).toMatchObject({ activeMinions: [], approvalChildren: [] });
      if (surface === "Activity") {
        render(createElement(ActivityView, { sessions: [session], nodes: [], socketSend: socket.send, socketSubscribe: socket.subscribe,
          onLaunchLeader: noop, onCommitLaunchLeader: noop, onCancelLaunchLeader: noop, onOpenInCanvas: noop,
          onExpandFullscreen: noop, onStopSession: noop, onAttachToCanvas: noop, onUpdateNodeData: noop }));
        fireEvent.click(within(document.querySelector(".act-main") as HTMLElement).getByRole("button", { name: /primary/i }));
      } else if (surface === "mobile") {
        render(createElement(SessionChatScreen, { sessionKey: "primary", session, send: socket.send, subscribe: socket.subscribe, onBack: noop }));
      } else {
        render(createElement(CanvasCrew, { socket }));
        if (surface === "Canvas fullscreen") fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
      }
      await socket.flush();
      await act(async () => { await h.start(); });
      await socket.flush();
      expect(h.host.taskState).toBeNull();
      const first = h.graph.snapshot("graph").attempts[0]!;
      const childKey = String(first.session_run_key);
      const visibleSurface = surface === "Canvas fullscreen" ? within(screen.getByTestId("leader-fullscreen-overlay")) : screen;
      const panel = () => visibleSurface.getByRole("region", { name: "Tool approvals for Graph child" });
      expect(panel()).toBeVisible();
      // Canonical discovery did not alter legacy crew badges or plan semantics.
      expect(h.ctx.registry.snapshot()[0]!.activeMinions).toEqual([]);
      await act(async () => {
        socket.deliver({ type: "socket_disconnected" });
        clearConnectionSubscriptions(h.ws); setConnectionProject(h.ws, null);
        socket.deliver({ type: "socket_reconnected" });
      });
      await socket.flush();
      expect(panel()).toBeVisible();
      fireEvent.click(within(panel()).getByRole("button", { name: "Allow once" }));
      await socket.flush();
      expect(await prompts.get(childKey)).toBe("allow_once");
      expect(socket.sent).toContainEqual(expect.objectContaining({ type: "respond_tool_approval", sessionKey: childKey, approvalDecision: "allow_once" }));
      const oldHost = h.ctx.registry.get(childKey)!;
      let staleCallback!: Promise<string>;
      await act(async () => {
        const ask = oldHost.toolApprovals.begin(oldHost.abortController.signal,
          event => h.ctx.bus.emitToSession(childKey, { ...event }));
        staleCallback = ask({ tool: "Superseded command", input: { command: "pwd" } });
      });
      expect(within(panel()).getByText("Superseded command")).toBeVisible();
      // A failed graph attempt retries even if its old durable child has not sealed.
      h.graph.scheduler.terminal({ runId: "graph", attemptId: String(first.id), generation: 1,
        actorSessionKey: childKey, idempotencyKey: "fail", expectedRunRevision: h.graph.snapshot("graph").run.revision, at: 10 }, "failed", {});
      await act(async () => { await h.graph.tick("graph"); });
      await socket.flush();
      const next = h.graph.snapshot("graph").attempts.find(attempt => attempt.attempt_number === 2)!;
      const nextKey = String(next.session_run_key);
      expect(h.wsSent.filter(msg => msg.type === "sync_response").at(-1)).toMatchObject({ approvalChildren: [{ sessionKey: nextKey, attemptNumber: 2 }] });
      expect(within(panel()).getByText(nextKey)).toBeVisible();
      expect(screen.queryByText("Superseded command")).toBeNull();
      // Even a late old-attempt live snapshot cannot remount a retired member.
      await act(async () => h.ctx.bus.emitToSession(childKey, { type: "tool_approval_snapshot",
        sessionKey: childKey, requests: oldHost.toolApprovals.snapshot() }));
      expect(screen.queryByText("Superseded command")).toBeNull();
      await act(async () => oldHost.abortController.abort());
      expect(await staleCallback).toBe("deny");
      // A foreign WorkItem cannot become a member even with a matching parent key.
      createWorkItem(h.db, { id: "foreign", projectId: "project", projectPath: process.cwd(), title: "Foreign", changeMode: "live", at: 12 });
      startWorkItemIteration(h.db, { workItemId: "foreign", runKey: "foreign-primary", idempotencyKey: "foreign", expectedLifecycleRevision: 0, expectedCurrentRunKey: null, at: 12 });
      createChildWorkItemRun(h.db, { workItemId: "foreign", runKey: "foreign-child", parentRunKey: "foreign-primary", taskId: "node", attemptNumber: 99, idempotencyKey: "foreign-child", at: 12 });
      h.db.prepare("UPDATE sessions SET parent_run_key='primary' WHERE session_key='foreign-child'").run();
      expect(sessionApprovalChildren("primary").map(child => child.sessionKey)).toEqual([nextKey]);
      expect(socket.sent).not.toContainEqual({ type: "get_tool_approvals", sessionKey: "foreign-child" });
      // Expiry denies the callback, removes the panel, and cannot be replayed.
      const nextHost = h.ctx.registry.get(nextKey)!;
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_001);
      await act(async () => { expect(nextHost.toolApprovals.snapshot()).toEqual([]); });
      clock.mockRestore();
      await socket.flush();
      expect(await prompts.get(nextKey)).toBe("deny");
      expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
      // Superseding the primary removes every canonical child from old views.
      await act(async () => {
        h.children.sealPrimaryRun({ workItemId: "work", runKey: "primary", outcome: "completed",
          expectedCurrentRunKey: "primary", expectedLifecycleRevision: 1, at: 20 });
        startWorkItemIteration(h.db, { workItemId: "work", runKey: "new-primary", idempotencyKey: "new-primary",
          expectedCurrentRunKey: "primary", expectedLifecycleRevision: 2, at: 21 });
      });
      await socket.flush();
      expect(h.wsSent.filter(msg => msg.type === "sync_response").at(-1)).toMatchObject({ approvalChildren: [] });
    } finally { h.graph.dispose(); for (const host of h.ctx.registry.values()) host.abortController.abort(); socket.stop(); }
  });
});


it("crew invalidations cannot route a foreign parent's identity", () => {
  expect(sessionCrewInvalidatedEnvelopeSchema.safeParse({ topic: "session:parent", type: "session_crew_invalidated", sessionKey: "parent" }).success).toBe(true);
  for (const topic of ["session:foreign", "global", "work-item:work"]) {
    expect(sessionCrewInvalidatedEnvelopeSchema.safeParse({ topic, type: "session_crew_invalidated", sessionKey: "parent" }).success).toBe(false);
  }
});
