import { describe, expect, it } from "vitest";
import type { WorkItemSnapshot } from "../shared/work-item-contracts.ts";
import { activeWorkspaceId, createZone, GLOBAL_WORKSPACE_ID } from "./canvas-zones.ts";
import type { CanvasNode } from "./types.ts";
import { PREVIEW_EDGE_LIMIT, PREVIEW_HEIGHT, PREVIEW_NODE_LIMIT, PREVIEW_WIDTH, workspaceCanvasPreview } from "./workspace-canvas-preview.ts";

const node = (id: string, x = 0, y = 0): CanvasNode => ({ id, type: "leader", position: { x, y }, size: { width: 400, height: 300 }, data: { taskName: id } });
const edge = (id: string, sourceNodeId: string, targetNodeId: string) => ({ id, sourceNodeId, targetNodeId });

describe("workspace canvas projection", () => {
  it.each([
    ["completed", "Completed", "success"], ["running", "Running", "running"],
    ["error", "Error", "error"], ["creating", "Creating", "creating"],
    ["waiting", "Waiting", "waiting"], ["stopped", "Stopped", "stopped"],
    ["idle", "Idle", "idle"], ["disconnected", "Disconnected", "disconnected"],
  ])("uses the semantic %s status color for agents", (status, label, token) => {
    for (const type of ["leader", "minion", "claude-session"]) {
      const preview = workspaceCanvasPreview([{ ...node("agent"), type, data: { status } }], []);
      expect(preview.nodes[0]).toMatchObject({ status: { label, color: `var(--status-${token})` } });
    }
  });

  it("does not give content nodes or unknown states a misleading status", () => {
    const preview = workspaceCanvasPreview([
      { ...node("context"), type: "markdown", data: { status: "completed" } },
      { ...node("unknown"), data: { status: "unexpected" } },
    ], []);
    expect(preview.nodes.map(n => n.status)).toEqual([null, null]);
  });

  it("uses canonical lifecycle presentation instead of stale session status", () => {
    const snapshot: WorkItemSnapshot = {
      id: "w", projectId: "p", projectPath: "/repo", title: "Task", waitKind: null,
      currentRunKey: "s", iteration: 1, lastTransitionAt: 2, createdAt: 1, updatedAt: 2,
      lifecycle: { runtimeState: "inactive", outcome: "completed", resolution: "open",
        changeMode: "live", integrationState: "live_clean", lifecycleRevision: 1 },
    };
    const project = (workItemSnapshot: WorkItemSnapshot) => workspaceCanvasPreview([
      { ...node("canonical"), data: { status: "running", workItemSnapshot } },
    ], []).nodes[0]?.status;
    expect(project(snapshot)).toEqual({ label: "Ready for review", color: "var(--status-success)" });
    expect(project({ ...snapshot, waitKind: "decision", lifecycle: { ...snapshot.lifecycle,
      runtimeState: "waiting", outcome: "none" } })).toEqual({ label: "Decision needed", color: "var(--status-warning)" });
    expect(project({ ...snapshot, lifecycle: { ...snapshot.lifecycle, changeMode: "worktree",
      integrationState: "worktree_conflicted" } })).toEqual({ label: "Merge conflict", color: "var(--status-error)" });
    expect(project({ ...snapshot, lifecycle: { ...snapshot.lifecycle, runtimeState: "working", outcome: "none" } }))
      .toEqual({ label: "Working", color: "var(--status-running)" });
  });

  it("shows legacy pending approvals as attention rather than running", () => {
    expect(workspaceCanvasPreview([{ ...node("approval"), data: { status: "running", approvalPending: true } }], [])
      .nodes[0]?.status).toEqual({ label: "Needs input", color: "var(--status-warning)" });
  });

  it("fits negative coordinates and preserves relative position and proportions", () => {
    const preview = workspaceCanvasPreview([node("a", -1000, -500), node("b", 2000, 700)], [edge("ab", "a", "b")]);
    expect(preview.name).toBe("Global");
    expect(preview.edges).toHaveLength(1);
    const [a, b] = preview.nodes;
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(b!.y).toBeGreaterThan(a!.y);
    for (const item of preview.nodes) {
      expect(item.width / item.height).toBeCloseTo(4 / 3);
      expect(item.x).toBeGreaterThanOrEqual(20);
      expect(item.y).toBeGreaterThanOrEqual(20);
      expect(item.x + item.width).toBeLessThanOrEqual(PREVIEW_WIDTH - 20);
      expect(item.y + item.height).toBeLessThanOrEqual(PREVIEW_HEIGHT - 20);
    }
  });

  it("uses the active workspace, follows owned output, and excludes cross-workspace edges", () => {
    const zone = createZone("zone", "Release");
    zone.data.nodeIds = ["a"];
    const global = createZone(GLOBAL_WORKSPACE_ID, "Global");
    global.data.activeWorkspaceId = "zone";
    const child = { ...node("child"), type: "render", data: { leaderId: "a" } };
    const nodes = [node("a"), node("b"), child, zone, global];
    expect(activeWorkspaceId(nodes)).toBe("zone");
    const preview = workspaceCanvasPreview(nodes, [edge("local", "a", "child"), edge("hidden", "a", "b"), edge("missing", "a", "gone")]);
    expect(preview.name).toBe("Release");
    expect(preview.nodes.map(n => n.id)).toEqual(["a", "child"]);
    expect(preview.edges.map(e => e.id)).toEqual(["local"]);
  });

  it("handles empty and malformed geometry without invalid SVG coordinates", () => {
    expect(workspaceCanvasPreview([], []).nodes).toEqual([]);
    const invalid = [node("bad", NaN), { ...node("zero"), size: { width: 0, height: 100 } }];
    expect(workspaceCanvasPreview(invalid, []).total).toBe(0);
    const preview = workspaceCanvasPreview([node("valid"), ...invalid], []);
    expect(preview.nodes).toHaveLength(1);
    expect(Number.isFinite(preview.nodes[0]!.x)).toBe(true);
  });

  it("bounds rendering cost and never includes streaming payloads", () => {
    const nodes = Array.from({ length: 1000 }, (_, i) => ({ ...node(String(i), i * 500), data: { taskName: "Task", streamingText: "secret", messages: ["secret"] } }));
    const edges = Array.from({ length: 1000 }, (_, i) => edge(String(i), "0", "1"));
    const preview = workspaceCanvasPreview(nodes, edges);
    expect(preview.total).toBe(1000);
    expect(preview.nodes).toHaveLength(PREVIEW_NODE_LIMIT);
    expect(preview.edges).toHaveLength(PREVIEW_EDGE_LIMIT);
    expect(preview.simplified).toBe(true);
    expect(JSON.stringify(preview)).not.toContain("secret");
  });
});
