import { describe, expect, it } from "vitest";
import { readCanonicalReviewDiff } from "./canonical-review-diff.ts";
import type { WorktreeContributionSnapshot } from "../shared/worktree-integration.ts";
const entry: WorktreeContributionSnapshot = { id: "c", lineageId: "l", workItemId: "w", originatingRunKey: "r", runKeys: ["r"],
  branchName: "feature", worktreePath: "/unused", baseSha: "a".repeat(40), headSha: "b".repeat(40), revision: 1,
  state: "ready", reviewState: "pending", cleanupState: "retained", createdAt: 1, updatedAt: 1 };
describe("canonical Git object reader input guards", () => {
  it.each([{ headSha: null }, { headSha: "--output=/tmp/unsafe" }, { baseSha: "HEAD" }, { headSha: "a".repeat(39) }])(
    "rejects uncollected or non-object references before accessing Git: %j", async patch => {
      await expect(readCanonicalReviewDiff("/does-not-exist", { ...entry, ...patch }, "r"))
        .rejects.toThrow("no valid collected review head");
    });
});
