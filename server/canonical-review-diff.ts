import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { exec } from "./worktree-exec.ts";
import type { ReviewDiff, ReviewFile, ReviewSnapshot } from "../shared/review-diff.ts";
import type { WorktreeContributionSnapshot, WorktreeLineageSnapshot } from "../shared/worktree-integration.ts";

const diffArgs = ["--no-ext-diff", "--no-textconv", "--no-color", "--find-renames"];
function patch(root: string, base: string, head: string, files: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile("git", ["--literal-pathspecs", "diff", ...diffArgs, "--unified=3", base, head, "--", ...files],
      { cwd: root, maxBuffer: 65536 }, (error, stdout, stderr) => {
        if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") resolve(null);
        else if (error) reject(new Error(`Canonical patch unavailable: ${stderr.slice(0, 512) || error.message}`));
        else resolve(stdout);
      });
  });
}
/** Only immutable Git objects are read. No index or working-file content is used. */
export async function readCanonicalReviewDiff(root: string, entry: WorktreeContributionSnapshot, runKey: string): Promise<ReviewDiff> {
  return readImmutableReviewDiff(root, entry.baseSha, entry.headSha, entry.branchName, {
    runKey, contributionBinding: "bound", contributionId: entry.id, contributionRevision: entry.revision, lineageId: entry.lineageId,
  });
}

export function readLineageReviewDiff(lineage: WorktreeLineageSnapshot): Promise<ReviewDiff> {
  return readImmutableReviewDiff(lineage.repositoryPath, lineage.baseSha, lineage.integrationHeadSha, lineage.integrationRef, {
    contributionBinding: "lineage", lineageId: lineage.id, lineageRevision: lineage.revision,
  });
}

type Binding = Pick<ReviewSnapshot, "contributionBinding" | "runKey" | "contributionId" | "contributionRevision" | "lineageId" | "lineageRevision">;
async function readImmutableReviewDiff(root: string, base: string, head: string | null, branch: string, binding: Binding): Promise<ReviewDiff> {
  if (!head || !/^[a-f0-9]{40,64}$/.test(base) || !/^[a-f0-9]{40,64}$/.test(head)) {
    throw new Error("Contribution has no valid collected review head. Wait for collection, then refresh.");
  }
  const [stats, statuses, commits] = await Promise.all([
    exec(["diff", ...diffArgs, "--numstat", "-z", base, head, "--"], root),
    exec(["diff", ...diffArgs, "--name-status", "-z", base, head, "--"], root),
    exec(["log", "--max-count=100", "--oneline", `${base}..${head}`], root),
  ]);
  const counts = new Map<string, { insertions: number; deletions: number; binary: boolean }>();
  const entries = stats.stdout.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const match = /^([^\t]+)\t([^\t]+)\t([\s\S]*)$/.exec(entries[i]!);
    if (!match) continue;
    let file = match[3]!;
    if (!file) { i++; file = entries[++i]!; }
    counts.set(file, { insertions: Number(match[1]) || 0, deletions: Number(match[2]) || 0, binary: match[1] === "-" });
  }
  const files: ReviewFile[] = [];
  const names = statuses.stdout.split("\0");
  for (let i = 0; i < names.length - 1;) {
    const status = names[i++]!, first = names[i++]!;
    const rename = status.startsWith("R") || status.startsWith("C");
    const file = rename ? names[i++]! : first;
    const count = counts.get(file);
    files.push({ file, status: rename ? "renamed" : status === "A" ? "added" : status === "D" ? "deleted" : "modified",
      insertions: count?.insertions ?? 0, deletions: count?.deletions ?? 0,
      ...(rename ? { previousFile: first } : {}), ...(count?.binary ? { patch: { state: "binary", reason: "Binary content; no text patch." } as const } : {}) });
  }
  if (files.length > 10_000) throw new Error("Contribution exceeds the 10000-file review limit. No partial review returned.");
  let bytes = 0, lines = 0;
  for (const file of files) {
    if (file.patch) continue;
    const text = await patch(root, base, head, [file.file, ...(file.previousFile ? [file.previousFile] : [])]);
    const size = text === null ? Infinity : Buffer.byteLength(text);
    const length = text === null ? Infinity : text.split("\n").length;
    if (size > 65536 || length > 2000 || bytes + size > 1024 * 1024 || lines + length > 10_000) {
      file.patch = { state: "large", reason: "Immutable patch exceeds the inline review budget (64 KiB / 2000 lines per file; 1 MiB / 10000 lines total)." };
    } else { file.patch = { state: "text", text: text! }; bytes += size; lines += length; }
  }
  const result: ReviewDiff = { filesChanged: files.length, files,
    insertions: files.reduce((n, f) => n + f.insertions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0),
    branch, commits: commits.stdout.trim().split("\n").filter(Boolean) };
  result.snapshot = { id: `sha256:${createHash("sha256").update(JSON.stringify([binding, base, head, result])).digest("hex")}`,
    capturedAt: Date.now(), baseSha: base, headSha: head, scope: "worktree",
    consistency: "immutable", ...binding };
  return result;
}
