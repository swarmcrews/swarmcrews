import { describe, expect, it } from "vitest";
import { isReviewDiff } from "./review-diff.ts";
const diff = { filesChanged: 1, insertions: 1, deletions: 0, files: [{ file: "a.txt", status: "added", insertions: 1, deletions: 0, patch: { state: "text", text: "+actual" } }], branch: "main", commits: [], snapshot: { id: `sha256:${"a".repeat(64)}`, capturedAt: 1, baseSha: null, headSha: null, scope: "workspace", runKey: "s", contributionBinding: "unbound", consistency: "sampled" } };
describe("review diff read contract", () => {
  it("accepts sampled unbound evidence and historical stats-only approvals", () => {
    expect(isReviewDiff(diff)).toBe(true);
    expect(isReviewDiff({ ...diff, snapshot: undefined, files: [{ ...diff.files[0], patch: undefined }] })).toBe(true);
  });
  it.each([
    { filesChanged: 2 }, { insertions: NaN }, { deletions: -1 }, { files: [{}] }, { snapshot: { ...diff.snapshot, id: "invented" } },
    { snapshot: { ...diff.snapshot, contributionBinding: "approved" } },
    { files: [{ ...diff.files[0], patch: { state: "text" } }] },
    { files: [{ ...diff.files[0], patch: { state: "text", text: "a".repeat(65_537) } }] },
  ])("rejects malformed or overstated evidence %j", patch => expect(isReviewDiff({ ...diff, ...patch })).toBe(false));
});

it("rejects aggregate patch floods even when every individual file fits", () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ ...diff.files[0], file: `file-${i}`, patch: { state: "text", text: "a".repeat(60_000) } }));
  expect(isReviewDiff({ ...diff, filesChanged: files.length, files })).toBe(false);
});

it("accepts fully bound immutable evidence but rejects mixed or incomplete binding", () => {
  const snapshot = { ...diff.snapshot, scope: "worktree", contributionBinding: "bound", consistency: "immutable",
    baseSha: "b".repeat(40), headSha: "a".repeat(40), contributionId: "contribution", contributionRevision: 2, lineageId: "lineage" };
  expect(isReviewDiff({ ...diff, snapshot })).toBe(true);
  for (const patch of [{ contributionId: undefined }, { contributionRevision: 2.5 }, { contributionRevision: -1 },
    { lineageId: "" }, { runKey: undefined }, { headSha: null }, { baseSha: "--malicious" },
    { consistency: "sampled" }, { contributionBinding: "unbound" }, { scope: "workspace" }]) {
    expect(isReviewDiff({ ...diff, snapshot: { ...snapshot, ...patch } })).toBe(false);
  }
});

it("distinguishes combined lineage evidence from contribution and sampled bindings", () => {
  const snapshot = { ...diff.snapshot, scope: "worktree", contributionBinding: "lineage", consistency: "immutable",
    baseSha: "b".repeat(40), headSha: "c".repeat(40), runKey: undefined, lineageId: "l", lineageRevision: 4 };
  expect(isReviewDiff({ ...diff, snapshot })).toBe(true);
  for (const patch of [{ lineageRevision: undefined }, { lineageRevision: 1.5 }, { lineageRevision: -1 },
    { contributionId: "c" }, { contributionRevision: 2 }, { runKey: "unrelated" }, { lineageId: "" },
    { baseSha: "HEAD" }, { headSha: null }, { consistency: "sampled" }, { contributionBinding: "bound" }]) {
    expect(isReviewDiff({ ...diff, snapshot: { ...snapshot, ...patch } })).toBe(false);
  }
  expect(isReviewDiff({ ...diff, snapshot: { ...diff.snapshot, lineageRevision: 4 } })).toBe(false);
});
