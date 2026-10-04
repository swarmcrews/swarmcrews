import type { WorktreeInfo, GitStatus, DetailedDiff } from "./worktree-types.js";
import { exec } from "./worktree-exec.js";
import { readReviewDiff } from "./review-diff.ts";

/**
 * Get a change summary for a worktree by parsing `git diff --stat`.
 */
export async function getWorktreeStatus(
  worktreePath: string,
): Promise<GitStatus> {
  let stdout: string;
  try {
    ({ stdout } = await exec(["diff", "--stat"], worktreePath));
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0, summary: "No changes" };
  }

  const trimmed = stdout.trim();
  if (!trimmed) {
    return { filesChanged: 0, insertions: 0, deletions: 0, summary: "No changes" };
  }

  // The last line of git diff --stat looks like:
  //  3 files changed, 10 insertions(+), 2 deletions(-)
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  const filesMatch = lastLine.match(/(\d+)\s+files?\s+changed/);
  if (filesMatch) filesChanged = parseInt(filesMatch[1]!, 10);

  const insMatch = lastLine.match(/(\d+)\s+insertions?\(\+\)/);
  if (insMatch) insertions = parseInt(insMatch[1]!, 10);

  const delMatch = lastLine.match(/(\d+)\s+deletions?\(-\)/);
  if (delMatch) deletions = parseInt(delMatch[1]!, 10);

  return { filesChanged, insertions, deletions, summary: lastLine.trim() };
}

/**
 * Get a detailed diff for a worktree branch vs its base.
 * Includes per-file stats and commit list — used for the approval dashboard.
 */
export async function getDetailedDiff(
  info: WorktreeInfo,
): Promise<DetailedDiff> {
  // Fail rather than inventing an empty review or a different base on Git errors.
  const mergeBase = (await exec(["merge-base", "HEAD", info.branch], info.projectPath)).stdout.trim();
  const actualBranch = (await exec(["rev-parse", "--abbrev-ref", "HEAD"], info.path)).stdout.trim();
  if (info.branch !== "HEAD" && actualBranch !== info.branch) throw new Error("Worktree branch changed. Refresh its session metadata before review.");
  const commits = (await exec(["log", "--max-count=100", "--oneline", `${mergeBase}..HEAD`], info.path)).stdout.trim().split("\n").filter(Boolean);
  return readReviewDiff(info.path, { baseSha: mergeBase, scope: info.branch === "HEAD" ? "workspace" : "worktree", branch: actualBranch, commits });
}
