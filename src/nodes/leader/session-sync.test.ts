import { describe, expect, it } from "vitest";
import type { ServerMessage } from "../../use-socket.ts";
import { LEADER_DEFAULT_DATA, type LeaderData } from "./types.ts";
import { hydrateLeaderSessionSync, recordRunConfiguration } from "./session-sync.ts";

type SyncResponse = Extract<ServerMessage, { type: "sync_response" }>;
const current = (overrides: Partial<LeaderData> = {}): LeaderData => ({
  ...LEADER_DEFAULT_DATA, sessionKey: "run-a", workItemId: "work-a", currentRunKey: "run-a", ...overrides,
});
const sync = (overrides: Partial<SyncResponse> = {}): SyncResponse => ({
  type: "sync_response", found: true, sessionKey: "run-a", ...overrides,
});

describe("hydrateLeaderSessionSync", () => {
  it("restores matching authoritative model, permissions and harness verbatim", () => {
    const state = current();
    expect(hydrateLeaderSessionSync(state, sync({ model: "gpt-6", permissionMode: "default", harness: "codex" })))
      .toMatchObject({ model: "gpt-6", permissionMode: "default", harness: "codex" });
    expect(state.model).toBe("opus");
  });

  it.each(["auto", "bypassPermissions", "default", "plan", "acceptEdits"])("hydrates known permission mode %s", permissionMode => {
    expect(hydrateLeaderSessionSync(current(), sync({ permissionMode })).permissionMode).toBe(permissionMode);
  });

  it.each([
    { found: false }, { sessionKey: "run-b" }, { runKey: "run-b" }, { workItemId: "work-b" },
  ])("cannot leak metadata across identity: %j", identity => {
    const state = current();
    expect(hydrateLeaderSessionSync(state, sync({ ...identity, model: "alien-model", harness: "alien-harness",
      permissionMode: "plan", taskName: "Other work" }))).toBe(state);
  });

  it("rejects stale full snapshots and canonical run conflicts", () => {
    const state = current({ highestLiveHistoryId: 20 });
    expect(hydrateLeaderSessionSync(state, sync({ model: "old-model", history: {
      before: null, highWater: 10, url: "/history", reset: false,
    } }))).toBe(state);
    const moved = current({ currentRunKey: "run-b" });
    expect(hydrateLeaderSessionSync(moved, sync({ model: "old-model" }))).toBe(moved);
  });

  it("does not bind a detached node from a sync response", () => {
    const state = current({ sessionKey: null });
    expect(hydrateLeaderSessionSync(state, sync())).toBe(state);
  });

  it.each([{}, { model: null, permissionMode: null }, { model: "", harness: "", permissionMode: "not-a-mode" }])(
    "does not fabricate missing metadata or infer defaults: %j", metadata => {
      const state = current({ model: "existing-provider-model", permissionMode: "plan", harness: "custom-harness" });
      expect(hydrateLeaderSessionSync(state, sync(metadata))).toMatchObject({
        model: "existing-provider-model", permissionMode: "plan", harness: "custom-harness",
      });
    });

  it("preserves thinking/history and task progress while hydrating existing sync responsibilities", () => {
    const state = current({ streamingText: "live answer", streamingThinkingText: "live thought", historyHighWater: 10,
      highestLiveHistoryId: 11, taskPlan: [{ taskId: "child", title: "old", description: "old", priority: "high",
        executor: "minion", status: "running", minionSessionKey: "child-run", result: null,
        cost: 0.25, createdAt: 1, completedAt: null, sessionSummary: "Latest evidence", activeStep: "Checking", progress: ["Started"] }] });
    const next = hydrateLeaderSessionSync(state, sync({ taskName: "Recovered", lastErrorFull: null,
      worktree: { path: "/repo/tree", branch: "work" }, sandboxPolicy: {
        requested: { filesystemScope: "workspace-write", approvalPolicy: "on-failure" },
        effective: { filesystemScope: "unmanaged", approvalPolicy: "unmanaged" },
        unsupported: ["filesystem", "approval"],
      }, taskPlan: [{ taskId: "child", title: "new", description: "new", priority: "high", executor: "minion",
        status: "blocked", minionSessionKey: "child-run", result: null, createdAt: 1, completedAt: null }] }));
    expect(next).toMatchObject({ streamingText: "live answer", streamingThinkingText: "live thought", historyHighWater: 10,
      highestLiveHistoryId: 11, taskName: "Recovered", fullError: null, worktreePath: "/repo/tree", worktreeBranch: "work" });
    expect(next.taskPlan[0]).toMatchObject({ title: "new", cost: 0.25, sessionSummary: "Latest evidence",
      activeStep: null, progress: ["Started"] });
    expect(next.messages).toBe(state.messages);
    expect(next.sandboxPolicy).toEqual({ filesystemScope: "workspace-write", approvalPolicy: "on-failure" });
  });

  it("preserves the worktree/live approval boundary", () => {
    const approval = { requested: true, summary: "Review", diff: { filesChanged: 1 } };
    expect(hydrateLeaderSessionSync(current({ worktreeIsolation: true }), sync({ approval })))
      .toMatchObject({ approvalPending: true, approvalSummary: "Review", approvalDiff: approval.diff });
    expect(hydrateLeaderSessionSync(current({ worktreeIsolation: false }), sync({ approval })).approvalPending).toBe(false);
  });
});


describe("recordRunConfiguration", () => {
  it("never invents facts from unknown/omitted metadata", () => {
    expect(recordRunConfiguration(sync(), null)).toEqual({ sessionKey: "run-a", model: null, harness: null, permissionMode: null });
    expect(recordRunConfiguration(sync({ permissionMode: "future-policy", model: "", harness: "" }), null))
      .toEqual({ sessionKey: "run-a", model: null, harness: null, permissionMode: null });
  });
  it("retains recorded fields only within the same run, and clears explicitly unknown fields", () => {
    const recorded = recordRunConfiguration(sync({ model: "gpt-6", harness: "codex", permissionMode: "default" }), null);
    expect(recordRunConfiguration(sync(), recorded)).toEqual(recorded);
    expect(recordRunConfiguration(sync({ model: null, permissionMode: null }), recorded)).toEqual({
      sessionKey: "run-a", model: null, harness: "codex", permissionMode: null,
    });
    expect(recordRunConfiguration(sync({ sessionKey: "run-b" }), recorded)).toEqual({
      sessionKey: "run-b", model: null, harness: null, permissionMode: null,
    });
  });
});
