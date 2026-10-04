import type { WorktreeContributionSnapshot, WorktreeLineageSnapshot } from "../../shared/worktree-integration.ts";
import type { ReviewDiff } from "../../shared/review-diff.ts";
export function canonicalDiff(entry: WorktreeContributionSnapshot): ReviewDiff {
  return { branch: entry.branchName, filesChanged: 1, insertions: 1, deletions: 1, commits: [],
    files: [{ file: "actual.ts", status: "modified", insertions: 1, deletions: 1,
      patch: { state: "text", text: "@@ -1 +1 @@\n-old\n+reviewed" } }],
    snapshot: { id: `sha256:${"a".repeat(64)}`, capturedAt: 1, baseSha: entry.baseSha, headSha: entry.headSha,
      scope: "worktree", runKey: entry.runKeys.at(-1) ?? entry.originatingRunKey, contributionBinding: "bound", consistency: "immutable",
      contributionId: entry.id, contributionRevision: entry.revision, lineageId: entry.lineageId } };
}
/** Multicast WebSocket boundary, matching production topic subscriptions. */
export function reviewSocket() {
  const listeners = new Set<(message: unknown) => void>();
  return {
    subscribe: (fn: (message: unknown) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    receive: (message: unknown) => { for (const fn of [...listeners]) fn(message); },
  };
}

export function canonicalLineageDiff(lineage: WorktreeLineageSnapshot): ReviewDiff {
  return { branch: lineage.integrationRef, filesChanged: 1, insertions: 1, deletions: 0, commits: [],
    files: [{ file: "combined.ts", status: "added", insertions: 1, deletions: 0, patch: { state: "text", text: "+combined result" } }],
    snapshot: { id: `sha256:${"c".repeat(64)}`, capturedAt: 1, baseSha: lineage.baseSha, headSha: lineage.integrationHeadSha,
      scope: "worktree", contributionBinding: "lineage", consistency: "immutable", lineageId: lineage.id, lineageRevision: lineage.revision } };
}
