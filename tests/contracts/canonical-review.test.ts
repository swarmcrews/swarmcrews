import { expect, it } from "vitest";
import { isReviewDiff } from "../../shared/review-diff.ts";
import { canonicalDiff } from "../support/canonical-review-fixture.ts";
import type { WorktreeContributionSnapshot } from "../../shared/worktree-integration.ts";
it("the additive get_worktree_diff contract requires complete immutable contribution identity", () => {
  const entry: WorktreeContributionSnapshot = { id: "c", lineageId: "l", workItemId: "w", originatingRunKey: "r", runKeys: ["r"],
    baseSha: "a".repeat(40), headSha: "b".repeat(40), branchName: "feature", worktreePath: "/fixture",
    state: "ready", reviewState: "pending", cleanupState: "retained", revision: 2, createdAt: 1, updatedAt: 1 };
  const wire = JSON.parse(JSON.stringify({ type: "control_response", command: "get_worktree_diff", success: true,
    sessionKey: "r", requestId: "correlation", topic: "session:r", diff: canonicalDiff(entry) }));
  expect(isReviewDiff(wire.diff)).toBe(true);
  expect(wire.diff.snapshot).toMatchObject({ contributionId: "c", contributionRevision: 2, lineageId: "l", runKey: "r",
    contributionBinding: "bound", consistency: "immutable", baseSha: entry.baseSha, headSha: entry.headSha });
  delete wire.diff.snapshot.headSha;
  expect(isReviewDiff(wire.diff)).toBe(false);
});
