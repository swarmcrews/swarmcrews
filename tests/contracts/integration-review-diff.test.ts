import { expect, it } from "vitest";
import { validateWsCommand } from "../../server/commands/schemas.ts";
import { COMMAND_TABLE } from "../../server/commands/index.ts";
it("durable read takes only lineage/contribution IDs and correlation, never client Git/path/run authority", () => {
  const query = { type: "get_integration_review_diff", lineageId: "l", requestId: "read-1" };
  expect(validateWsCommand(query).ok).toBe(true);
  expect(validateWsCommand({ ...query, contributionId: "c" }).ok).toBe(true);
  expect(COMMAND_TABLE).toHaveProperty(query.type);
  for (const extra of [{ lineageId: "" }, { lineageId: undefined }, { contributionId: "" },
    { baseSha: "a".repeat(40) }, { headSha: "b".repeat(40) }, { repositoryPath: "/client" },
    { runKey: "other" }, { sessionKey: "archived" }, { expectedIntegrationRevision: 3 }]) {
    expect(validateWsCommand({ ...query, ...extra }).ok).toBe(false);
  }
});

import { integrationReviewDiffResponseSchema } from "../../shared/integration-review.ts";
import { canonicalDiff, canonicalLineageDiff } from "../support/canonical-review-fixture.ts";
import type { WorktreeContributionSnapshot, WorktreeLineageSnapshot } from "../../shared/worktree-integration.ts";
it("wire success requires distinct immutable target binding and matching lineage topic", () => {
  const lineage = { id: "l", revision: 4, baseSha: "a".repeat(40), integrationHeadSha: "c".repeat(40), integrationRef: "combined" } as WorktreeLineageSnapshot;
  const entry = { id: "c", lineageId: "l", revision: 2, baseSha: "a".repeat(40), headSha: "b".repeat(40), runKeys: ["archived"], branchName: "feature" } as WorktreeContributionSnapshot;
  const wire = { type: "integration_review_diff_response", topic: "lineage:l", lineageId: "l", contributionId: null,
    requestId: "q", success: true, diff: canonicalLineageDiff(lineage) };
  expect(integrationReviewDiffResponseSchema.safeParse(JSON.parse(JSON.stringify(wire))).success).toBe(true);
  expect(integrationReviewDiffResponseSchema.safeParse({ ...wire, contributionId: "c", diff: canonicalDiff(entry) }).success).toBe(true);
  for (const extra of [{ topic: "lineage:other" }, { lineageId: "other" }, { contributionId: "c" }, { diff: canonicalDiff(entry) }]) {
    expect(integrationReviewDiffResponseSchema.safeParse({ ...wire, ...extra }).success).toBe(false);
  }
  expect(integrationReviewDiffResponseSchema.safeParse({ ...wire, success: false, diff: undefined, code: "conflict", error: "capture raced" }).success).toBe(true);
});
