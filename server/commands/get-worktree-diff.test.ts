import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exec } from "../worktree-exec.ts";
import { isReviewDiff } from "../../shared/review-diff.ts";
import { setup, cmd } from "../../tests/support/server-command-harness.ts";
import { getWorktreeDiff } from "./get-worktree-diff.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "command-review-")); roots.push(root);
  await exec(["init", "-b", "main"], root);
  await exec(["config", "user.name", "Test"], root);
  await exec(["config", "user.email", "test@example.test"], root);
  await exec(["commit", "--allow-empty", "-m", "base"], root);
  return root;
}
describe("get_worktree_diff real Git command contract", () => {
  it("returns correlated read-only workspace patches and server-owned run identity", async () => {
    const root = await repo(); const h = setup({ cwd: root });
    await fs.writeFile(path.join(root, "a.ts"), "actual\n");
    const before = (await exec(["status", "--porcelain=v1", "-z"], root)).stdout;
    getWorktreeDiff(h.ctx, cmd({ type: "get_worktree_diff", requestId: "review-1" }), h.ws);
    await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
    expect(h.wsSent[0]).toMatchObject({ topic: "session:leader-1", requestId: "review-1", success: true,
      diff: { snapshot: { runKey: h.host.runKey, scope: "workspace", contributionBinding: "unbound" }, files: [{ patch: { text: expect.stringContaining("+actual") } }] } });
    expect(isReviewDiff(h.wsSent[0]!["diff"])).toBe(true);
    expect(h.busSent).toHaveLength(0);
    expect((await exec(["status", "--porcelain=v1", "-z"], root)).stdout).toBe(before);
  });
  it("reads isolated committed and untracked changes against the actual base", async () => {
    const root = await repo(); const isolated = path.join(root, "isolated");
    await exec(["worktree", "add", "-b", "feature", isolated], root);
    await fs.writeFile(path.join(isolated, "committed.txt"), "committed\n");
    await exec(["add", "."], isolated); await exec(["commit", "-m", "feature"], isolated);
    await fs.writeFile(path.join(isolated, "new.txt"), "untracked\n");
    const h = setup({ cwd: isolated });
    h.host.worktree = { path: isolated, branch: "feature", leaderSessionKey: h.host.runKey, createdAt: 0, projectPath: root, lifecycle: "active" };
    getWorktreeDiff(h.ctx, cmd({ type: "get_worktree_diff" }), h.ws);
    await vi.waitFor(() => expect(h.wsSent).toHaveLength(1));
    expect(h.wsSent[0]).toMatchObject({ success: true, diff: { filesChanged: 2, snapshot: { scope: "worktree", runKey: "leader-1" } } });
  });
  it("rejects missing isolated worktrees and invalid repositories without empty success", async () => {
    const h = setup(); h.host.worktreeIsolation = true;
    getWorktreeDiff(h.ctx, cmd({ type: "get_worktree_diff" }), h.ws);
    expect(h.wsSent[0]).toMatchObject({ success: false, error: "No worktree for this session" });
    const root = await repo(); await fs.rm(path.join(root, ".git"), { recursive: true });
    const failed = setup({ cwd: root });
    getWorktreeDiff(failed.ctx, cmd({ type: "get_worktree_diff" }), failed.ws);
    await vi.waitFor(() => expect(failed.wsSent).toHaveLength(1));
    expect(failed.wsSent[0]).toMatchObject({ success: false, error: expect.stringContaining("git rev-parse") });
  });
  it("does not read another session when the requested host does not exist", () => {
    const h = setup();
    getWorktreeDiff(h.ctx, cmd({ type: "get_worktree_diff", sessionKey: "unknown" }), h.ws);
    expect(h.wsSent[0]).toMatchObject({ type: "error", message: "Session unknown not found" });
  });
});
