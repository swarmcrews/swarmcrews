// Simulated, portable wire evidence for UI journeys; real immutable Git/SQLite
// collection is exercised by server/commands/canonical-review.test.ts.
export const reviewFiles = [
  { file: 'src/auth/session-recovery.ts', status: 'modified', insertions: 1, deletions: 1,
    patch: { state: 'text', text: '@@ -1 +1 @@\n-oldPolicy\n+reviewedPolicy' } },
  { file: 'src/components/responsive/' + 'longfilename'.repeat(9) + '.tsx', previousFile: 'src/previous-layout.tsx', status: 'renamed', insertions: 0, deletions: 0,
    patch: { state: 'text', text: 'similarity index 100%\nrename from src/previous-layout.tsx\nrename to responsive-layout.tsx' } },
  { file: 'src/deleted.ts', status: 'deleted', insertions: 0, deletions: 1,
    patch: { state: 'text', text: '@@ -1 +0,0 @@\n-removedPolicy' } },
  { file: 'assets/image.bin', status: 'added', insertions: 0, deletions: 0,
    patch: { state: 'binary', reason: 'Binary content; no text patch.' } },
  { file: 'generated/large.ts', status: 'added', insertions: 2500, deletions: 0,
    patch: { state: 'large', reason: 'Patch exceeds the 2000-line inline limit.' } },
];
export function reviewPatchDiff(runKey = 'layout-0', contribution) {
  return { filesChanged: reviewFiles.length, files: reviewFiles, insertions: 2501, deletions: 2, commits: [], branch: 'audit/worktree',
    snapshot: { id: 'sha256:' + 'a'.repeat(64), capturedAt: 1700000000000,
      baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), runKey,
      ...(contribution ? { scope: 'worktree', consistency: 'immutable', contributionBinding: 'bound',
        contributionId: contribution.id, contributionRevision: contribution.revision, lineageId: contribution.lineageId }
        : { scope: 'workspace', contributionBinding: 'unbound', consistency: 'sampled' }) } };
}

export function reviewLineagePatchDiff(lineage) {
  return { filesChanged: reviewFiles.length + 1, files: [
    { file: 'src/combined-result.ts', status: 'added', insertions: 1, deletions: 0,
      patch: { state: 'text', text: '@@ -0,0 +1 @@\n+combinedResult' } }, ...reviewFiles],
    insertions: 2502, deletions: 2, commits: [], branch: lineage.integrationRef,
    snapshot: { id: 'sha256:' + 'c'.repeat(64), capturedAt: 1700000000000,
      baseSha: lineage.baseSha, headSha: lineage.integrationHeadSha, scope: 'worktree', consistency: 'immutable',
      contributionBinding: 'lineage', lineageId: lineage.id, lineageRevision: lineage.revision } };
}
