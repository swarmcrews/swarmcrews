import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exec } from "./worktree-exec.ts";
import { getDetailedDiff, getWorktreeStatus } from "./worktree-diff.ts";
import type { WorktreeInfo } from "./worktree-types.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "isolated-diff-")); roots.push(root);
  await exec(["init", "-b", "main"], root);
  await exec(["config", "user.name", "Test"], root);
  await exec(["config", "user.email", "test@example.test"], root);
  await fs.writeFile(path.join(root, "a.txt"), "base\n");
  await exec(["add", "."], root); await exec(["commit", "-m", "initial"], root);
  const worktree = path.join(root, "isolated");
  await exec(["worktree", "add", "-b", "feature", worktree], root);
  const info: WorktreeInfo = { path: worktree, branch: "feature", leaderSessionKey: "k", projectPath: root, lifecycle: "active", createdAt: 0 };
  return { root, worktree, info };
}
describe("getDetailedDiff with a real isolated branch", () => {
  it("uses the final base-to-working delta, not summed intermediate edits", async () => {
    const { root, worktree, info } = await fixture();
    await fs.writeFile(path.join(worktree, "a.txt"), "committed\n");
    await exec(["add", "."], worktree); await exec(["commit", "-m", "branch edit"], worktree);
    await fs.writeFile(path.join(worktree, "a.txt"), "final\n");
    await fs.writeFile(path.join(worktree, "new.txt"), "untracked\n");
    const before = (await exec(["status", "--porcelain=v1", "-z"], worktree)).stdout;
    const diff = await getDetailedDiff(info);
    expect(diff).toMatchObject({ filesChanged: 2, insertions: 2, deletions: 1, branch: "feature", snapshot: { scope: "worktree", contributionBinding: "unbound" } });
    expect(diff.files.find(f => f.file === "a.txt")).toMatchObject({ insertions: 1, deletions: 1, patch: { text: expect.stringContaining("-base\n+final") } });
    expect(diff.commits[0]).toContain("branch edit");
    expect(diff.snapshot?.baseSha).toBe((await exec(["rev-parse", "HEAD"], root)).stdout.trim());
    expect((await exec(["status", "--porcelain=v1", "-z"], worktree)).stdout).toBe(before);
  });
  it("reports deleted and binary files without false text hunks", async () => {
    const { worktree, info } = await fixture();
    await fs.unlink(path.join(worktree, "a.txt"));
    await fs.writeFile(path.join(worktree, "binary.bin"), Buffer.from([0, 1]));
    const diff = await getDetailedDiff(info);
    expect(diff.files.find(f => f.file === "a.txt")).toMatchObject({ status: "deleted", patch: { text: expect.stringContaining("-base") } });
    expect(diff.files.find(f => f.file === "binary.bin")).toMatchObject({ patch: { state: "binary" } });
  });
  it("fails loudly for a missing branch rather than pretending the review is empty", async () => {
    const { info } = await fixture();
    await expect(getDetailedDiff({ ...info, branch: "missing" })).rejects.toThrow("git merge-base");
  });
});
describe("getWorktreeStatus", () => {
  it("reads singular and plural change stats and clean state", async () => {
    const { worktree } = await fixture();
    expect(await getWorktreeStatus(worktree)).toMatchObject({ filesChanged: 0, summary: "No changes" });
    await fs.writeFile(path.join(worktree, "a.txt"), "one\ntwo\n");
    expect(await getWorktreeStatus(worktree)).toMatchObject({ filesChanged: 1, insertions: 2, deletions: 1 });
    expect(await getWorktreeStatus("/nonexistent-review-fixture")).toMatchObject({ filesChanged: 0, summary: "No changes" });
  });
});

it("refuses a worktree whose attached branch metadata no longer matches Git", async () => {
  const { worktree, info } = await fixture();
  await exec(["switch", "-c", "different-branch"], worktree);
  await expect(getDetailedDiff(info)).rejects.toThrow("branch changed");
});

it("keeps the actual-diff provider's explicit HEAD baseline truthful for shared checkouts", async () => {
  const { root } = await fixture();
  const diff = await getDetailedDiff({ path: root, projectPath: root, branch: "HEAD", leaderSessionKey: "live", createdAt: 0, lifecycle: "active" });
  expect(diff.branch).toBe("main");
  expect(diff.snapshot?.scope).toBe("workspace");
});
