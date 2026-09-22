import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { exec } from "./worktree-exec.ts";
import type { DetailedDiff, FileChange } from "./worktree-types.ts";

const MAX_REVIEW_FILES = 10_000;
const MAX_UNTRACKED_BYTES = 64 * 1024 * 1024;
const REMEDIATION = "Exclude generated artifacts using .gitignore or .git/info/exclude, or review a smaller change set, then retry. No partial review was returned.";

function contentLimitError(): Error {
  return new Error(`Workspace exceeds the 64 MiB untracked-content review limit. ${REMEDIATION}`);
}

/** Read the shared workspace without staging files or attributing them to one agent. */
export async function getWorkspaceDiff(cwd: string): Promise<DetailedDiff> {
  const root = (await exec(["rev-parse", "--show-toplevel"], cwd)).stdout.trim();
  const branch = (await exec(["rev-parse", "--abbrev-ref", "HEAD"], root)
    .catch(() => ({ stdout: "Unborn branch" }))).stdout.trim();
  const hasHead = await exec(["rev-parse", "--verify", "HEAD"], root).then(() => true, () => false);
  const files = new Map<string, FileChange>();
  if (hasHead) {
    const [stats, statuses] = await Promise.all([
      exec(["diff", "--numstat", "--no-renames", "-z", "HEAD", "--"], root),
      exec(["diff", "--name-status", "--no-renames", "-z", "HEAD", "--"], root),
    ]);
    for (const entry of stats.stdout.split("\0").filter(Boolean)) {
      const match = /^([^\t]+)\t([^\t]+)\t([\s\S]+)$/.exec(entry);
      if (!match) continue;
      const [, additions, deletions, file] = match;
      files.set(file!, { file: file!, insertions: Number(additions) || 0,
        deletions: Number(deletions) || 0, status: "modified" });
    }
    const entries = statuses.stdout.split("\0");
    for (let i = 0; i + 1 < entries.length; i += 2) {
      const file = files.get(entries[i + 1]!);
      if (file) file.status = entries[i] === "A" ? "added" : entries[i] === "D" ? "deleted" : "modified";
    }
  }
  const untracked = await exec(["ls-files", ...(hasHead ? [] : ["--cached"]),
    "--others", "--exclude-standard", "-z"], root);
  const candidates = [...new Set([...files.keys(), ...untracked.stdout.split("\0").filter(Boolean)])];
  // Check before reading file contents or returning a giant payload to the UI.
  if (candidates.length > MAX_REVIEW_FILES) {
    throw new Error(`Workspace size of ${candidates.length} candidate files exceeds the ${MAX_REVIEW_FILES}-file review limit. ${REMEDIATION}`);
  }
  let scannedBytes = 0;
  for (const file of candidates) {
    if (files.has(file)) continue;
    const absolute = path.join(root, file);
    const stat = await fs.lstat(absolute).catch(() => null);
    if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) continue;
    if (scannedBytes + stat.size > MAX_UNTRACKED_BYTES) throw contentLimitError();
    // Stream rather than buffering arbitrary assets. Count bytes while reading too,
    // so a file growing after lstat cannot bypass the content budget.
    const chunks = stat.isSymbolicLink()
      ? [Buffer.from(await fs.readlink(absolute))]
      : createReadStream(absolute);
    let lines = 0;
    let lastByte: number | undefined;
    let binary = false;
    for await (const chunk of chunks) {
      const bytes = chunk as Buffer;
      scannedBytes += bytes.length;
      if (scannedBytes > MAX_UNTRACKED_BYTES) throw contentLimitError();
      binary ||= bytes.includes(0);
      for (const byte of bytes) if (byte === 10) lines++;
      if (bytes.length) lastByte = bytes[bytes.length - 1];
    }
    const insertions = binary || lastByte === undefined ? 0 : lines + (lastByte === 10 ? 0 : 1);
    files.set(file, { file, insertions, deletions: 0, status: "added" });
  }
  const changes = [...files.values()];
  return { filesChanged: changes.length, files: changes, commits: [], branch,
    insertions: changes.reduce((n, file) => n + file.insertions, 0),
    deletions: changes.reduce((n, file) => n + file.deletions, 0) };
}
