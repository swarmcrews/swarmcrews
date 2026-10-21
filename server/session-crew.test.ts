import { sessionApprovalChildren } from "./session-crew.ts";
import { createChildWorkItemRun, sealChildWorkItemRun } from "./work-item-child-repo.ts";
import { MAX_APPROVAL_CHILDREN } from "../shared/session-crew.ts";
import { afterEach, describe, expect, it } from "vitest";
import { setup, cmd } from "../tests/support/server-command-harness.ts";
import { openPersistDb, closePersistDb } from "./session-persist.ts";
import { createWorkItem, startWorkItemIteration, sealWorkItemRun } from "./work-item-repo.ts";
import { SqliteWorkItemService } from "./work-item-service-sqlite.ts";
import { TaskGraphService } from "./task-graph/service.ts";
import { syncSession } from "./commands/sync-session.ts";
import type { GraphRevisionInput, SourceSnapshot } from "../shared/task-graph-contracts.ts";

// Real leased graph dispatch -> child service -> durable session; no task-tool roster.
async function graphCrewFixture() {
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
  await graph.startRun({ id: "graph", workItemId: "work", primaryRunKey: "primary", revisionId: "revision", sourceSnapshot: source, expectedLifecycleRevision: 1, at: 4 });
  return { ...h, db, graph, children };
}
afterEach(() => closePersistDb());
describe("canonical approval child projection", () => {
  it("projects a real dispatched graph child in inventory and reconnect without legacy rosters", async () => {
    const h = await graphCrewFixture();
    try {
      const attempt = h.graph.snapshot("graph").attempts[0]!;
      expect(attempt.session_run_key).toBeTruthy();
      expect(h.host.taskState).toBeNull();
      const expected = [{ sessionKey: attempt.session_run_key, taskId: "node", attemptId: attempt.id, attemptNumber: 1, title: "Graph child" }];
      expect(h.ctx.registry.snapshot()[0]).toMatchObject({ activeMinions: [], approvalChildren: expected });
      syncSession(h.ctx, cmd({ type: "sync_session", sessionKey: "primary" }), h.ws);
      expect(h.wsSent[0]).toMatchObject({ taskPlan: [], activeMinions: [], approvalChildren: expected });
      expect(h.busSent).toContainEqual(expect.objectContaining({ topic: "session:primary", type: "session_crew_invalidated", sessionKey: "primary" }));
    } finally { h.graph.dispose(); }
  });
});


it("bounds children independently of legacy tasks and excludes retired attempts and primaries", () => {
  const db = openPersistDb(":memory:");
  createWorkItem(db, { id: "work", projectId: "project", projectPath: process.cwd(), title: "Work", changeMode: "live", at: 1 });
  startWorkItemIteration(db, { workItemId: "work", runKey: "primary", idempotencyKey: "primary", expectedLifecycleRevision: 0, expectedCurrentRunKey: null, at: 2 });
  const child = (runKey: string, taskId: string, attemptNumber = 1) => createChildWorkItemRun(db, {
    workItemId: "work", parentRunKey: "primary", runKey, taskId, attemptNumber, idempotencyKey: runKey, at: 3,
  });
  child("old", "retry"); child("new", "retry", 2);
  expect(sessionApprovalChildren("primary").map(child => child.sessionKey)).toEqual(["new"]);
  sealChildWorkItemRun(db, { workItemId: "work", runKey: "new", outcome: "completed", at: 4 });
  expect(sessionApprovalChildren("primary")).toEqual([]); // never resurrect old open attempt
  for (let i = 0; i < MAX_APPROVAL_CHILDREN + 10; i++) child(`child-${i}`, `task-${i}`);
  const projected = sessionApprovalChildren("primary");
  expect(projected).toHaveLength(MAX_APPROVAL_CHILDREN);
  expect(new Set(projected.map(child => child.sessionKey)).size).toBe(MAX_APPROVAL_CHILDREN);
  expect(sessionApprovalChildren("old")).toEqual([]); // a child cannot become a parent
  sealWorkItemRun(db, { workItemId: "work", runKey: "primary", outcome: "stopped", expectedLifecycleRevision: 1, expectedCurrentRunKey: "primary", at: 5 });
  // Stopping/sealing the current Leader preserves its running children until
  // a replacement primary actually takes authority.
  expect(sessionApprovalChildren("primary")).toHaveLength(MAX_APPROVAL_CHILDREN);
  startWorkItemIteration(db, { workItemId: "work", runKey: "next", idempotencyKey: "next", expectedLifecycleRevision: 2, expectedCurrentRunKey: "primary", at: 6 });
  expect(sessionApprovalChildren("primary")).toEqual([]);
  expect(sessionApprovalChildren("next")).toEqual([]);
});
