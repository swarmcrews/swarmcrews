import { exec } from "./worktree-exec.ts";
import { readReviewDiff } from "./review-diff.ts";
import type { DetailedDiff } from "./worktree-types.ts";

/** Read all shared changes without attributing them to one agent. */
export async function getWorkspaceDiff(cwd: string): Promise<DetailedDiff> {
  const root = (await exec(["rev-parse", "--show-toplevel"], cwd)).stdout.trim();
  const branch = (await exec(["rev-parse", "--abbrev-ref", "HEAD"], root)
    .catch(() => ({ stdout: "Unborn branch" }))).stdout.trim();
  const baseSha = (await exec(["rev-parse", "--verify", "HEAD"], root)
    .catch(() => ({ stdout: "" }))).stdout.trim() || null;
  return readReviewDiff(root, { baseSha, branch, scope: "workspace" });
}
