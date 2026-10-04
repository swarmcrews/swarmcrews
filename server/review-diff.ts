import fs from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { exec } from "./worktree-exec.ts";
import type { DetailedDiff, FileChange } from "./worktree-types.ts";
import type { ReviewPatch } from "../shared/review-diff.ts";

const MAX_FILES = 10_000;
const MAX_CONTENT = 64 * 1024 * 1024;
const MAX_FILE_PATCH = 64 * 1024;
const MAX_PATCHES = 1024 * 1024;
const MAX_TEXT_FILE = 512 * 1024;
const MAX_FILE_LINES = 2000;
const MAX_PATCH_LINES = 10_000;
const REMEDIATION = "Exclude generated artifacts using .gitignore or .git/info/exclude, or review a smaller change set, then retry. No partial review was returned.";

/** Git paths are data, never pathspec expressions or external file access. */
export async function safeReviewPath(root: string, file: string): Promise<string> {
  if (!file || file.includes("\0") || path.isAbsolute(file) || file.split("/").some(p => p === ".." || p === ".")) {
    throw new Error("Unsafe review path");
  }
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Review path escapes repository");
  // The final symlink is read as link text; directory symlinks are never followed.
  let parent = path.dirname(absolute);
  while (parent !== root) {
    const stat = await fs.lstat(parent).catch(() => null);
    if (stat?.isSymbolicLink()) throw new Error("Review path crosses a directory symlink");
    parent = path.dirname(parent);
  }
  return absolute;
}

function trackedPatch(root: string, base: string, paths: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile("git", ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", "--unified=3", base, "--", ...paths],
      { cwd: root, maxBuffer: MAX_FILE_PATCH }, (error, stdout, stderr) => {
        if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") resolve(null);
        else if (error) reject(new Error(`Patch unavailable: ${stderr.slice(0, 512) || error.message}`));
        else resolve(stdout);
      });
  });
}

/** Capture sampled working-tree evidence. No staging, committing, or approval. */
export async function readReviewDiff(cwd: string, options: {
  baseSha: string | null;
  scope: "workspace" | "worktree";
  branch: string;
  commits?: string[];
}): Promise<DetailedDiff> {
  const root = await fs.realpath(cwd);
  const base = options.baseSha;
  const initialHead = (await exec(["rev-parse", "--verify", "HEAD"], root).catch(() => ({ stdout: "" }))).stdout.trim() || null;
  const files = new Map<string, FileChange>();
  if (base) {
    const [stats, statuses] = await Promise.all([
      exec(["diff", "--no-ext-diff", "--no-textconv", "--numstat", "--find-renames", "-z", base, "--"], root),
      exec(["diff", "--no-ext-diff", "--name-status", "--find-renames", "-z", base, "--"], root),
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
    const names = statuses.stdout.split("\0");
    for (let i = 0; i < names.length - 1;) {
      const status = names[i++]!;
      const first = names[i++]!;
      const rename = status.startsWith("R") || status.startsWith("C");
      const file = rename ? names[i++]! : first;
      const count = counts.get(file);
      files.set(file, { file, insertions: count?.insertions ?? 0, deletions: count?.deletions ?? 0,
        status: rename ? "renamed" : status === "A" ? "added" : status === "D" ? "deleted" : "modified",
        ...(rename ? { previousFile: first } : {}),
        ...(count?.binary ? { patch: { state: "binary" } } : {}) });
    }
  }
  const untracked = (await exec(["ls-files", ...(base ? [] : ["--cached"]), "--others", "--exclude-standard", "-z"], root)).stdout.split("\0").filter(Boolean);
  const candidates = [...new Set([...files.keys(), ...untracked])];
  if (candidates.length > MAX_FILES) throw new Error(`Workspace size of ${candidates.length} candidate files exceeds the ${MAX_FILES}-file review limit. ${REMEDIATION}`);
  let scannedBytes = 0;
  let patchBytes = 0;
  let trackedBytes = 0;
  let patchLines = 0;
  const contentHash = createHash("sha256");
  for (const file of candidates) {
    const tracked = files.has(file);
    const change: FileChange = files.get(file) ?? { file, insertions: 0, deletions: 0, status: "added" };
    const absolute = await safeReviewPath(root, file);
    if (change.previousFile) await safeReviewPath(root, change.previousFile);
    const stat = await fs.lstat(absolute).catch(() => null);
    if (!tracked && (!stat || (!stat.isFile() && !stat.isSymbolicLink()))) continue;
    contentHash.update(JSON.stringify([file, stat?.mode ?? null, stat?.size ?? null]));
    let binary = false;
    let lines = 0;
    let last: number | undefined;
    const textChunks: Buffer[] = [];
    let bytesRead = 0;
    if (stat && (stat.isFile() || stat.isSymbolicLink())) {
      if (!tracked && scannedBytes + stat.size > MAX_CONTENT) throw new Error(`Workspace exceeds the 64 MiB untracked-content review limit. ${REMEDIATION}`);
      // O_NOFOLLOW prevents a final-file swap to an external symlink during capture.
      const handle = stat.isSymbolicLink() ? null : await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        // Verify the opened descriptor on Linux too, closing the ancestor-swap race.
        if (handle && process.platform === "linux") {
          const openedPath = await fs.realpath(`/proc/self/fd/${handle.fd}`);
          if (!openedPath.startsWith(root + path.sep)) throw new Error("Opened review file escapes repository");
        }
        const chunks = stat.isSymbolicLink() ? [Buffer.from(await fs.readlink(absolute))]
          : createReadStream(absolute, { fd: handle!.fd, autoClose: false });
        for await (const chunk of chunks) {
          const bytes = chunk as Buffer;
          bytesRead += bytes.length;
          if (tracked) {
            trackedBytes += bytes.length;
            if (trackedBytes > MAX_CONTENT) throw new Error(`Workspace exceeds the 64 MiB tracked-content review limit. ${REMEDIATION}`);
          }
          if (!tracked) {
            scannedBytes += bytes.length;
            if (scannedBytes > MAX_CONTENT) throw new Error(`Workspace exceeds the 64 MiB untracked-content review limit. ${REMEDIATION}`);
          }
          contentHash.update(bytes);
          binary ||= bytes.includes(0);
          for (const byte of bytes) if (byte === 10) lines++;
          if (bytes.length) last = bytes[bytes.length - 1];
          if (!tracked && bytesRead <= MAX_FILE_PATCH) textChunks.push(bytes);
        }
      } finally { await handle?.close(); }
    }
    const text = Buffer.concat(textChunks).toString("utf8");
    if (!tracked) change.insertions = binary || last === undefined ? 0 : lines + (last === 10 ? 0 : 1);
    let patch: ReviewPatch;
    if (binary || change.patch?.state === "binary") patch = { state: "binary", reason: "Binary content; no text patch." };
    else if (bytesRead > MAX_TEXT_FILE || (!tracked && bytesRead > MAX_FILE_PATCH)) patch = { state: "large", reason: "File exceeds the inline patch limit (64 KiB patch / 512 KiB source)." };
    else if (patchBytes >= MAX_PATCHES) patch = { state: "large", reason: "Snapshot reached the 1 MiB combined patch budget." };
    else {
      const raw = tracked && base ? await trackedPatch(root, base, [file, ...(change.previousFile ? [change.previousFile] : [])])
        : `diff --git ${JSON.stringify(`a/${file}`)} ${JSON.stringify(`b/${file}`)}\nnew file mode ${stat?.isSymbolicLink() ? "120000" : stat && (stat.mode & 0o111) ? "100755" : "100644"}\n${text ? `--- /dev/null\n+++ ${JSON.stringify(`b/${file}`)}\n@@ -0,0 +1,${change.insertions} @@\n${text.split("\n").map((line, i, all) => i === all.length - 1 && !line ? "" : `+${line}\n`).join("")}${!text.endsWith("\n") ? "\\ No newline at end of file\n" : ""}` : ""}`;
      const lineCount = raw?.split("\n").length ?? 0;
      if (lineCount > MAX_FILE_LINES) patch = { state: "large", reason: "Patch exceeds the 2000-line inline limit." };
      else if (patchLines + lineCount > MAX_PATCH_LINES) patch = { state: "large", reason: "Snapshot reached the 10000-line combined patch budget." };
      else if (raw === null || Buffer.byteLength(raw) > MAX_FILE_PATCH) patch = { state: "large", reason: "Patch exceeds the 64 KiB inline limit." };
      else if (patchBytes + Buffer.byteLength(raw) > MAX_PATCHES) patch = { state: "large", reason: "Snapshot reached the 1 MiB combined patch budget." };
      else { patch = { state: "text", text: raw }; patchBytes += Buffer.byteLength(raw); patchLines += lineCount; }
    }
    const after = await fs.lstat(absolute).catch(() => null);
    if (JSON.stringify([stat?.dev, stat?.ino, stat?.size, stat?.mtimeMs, stat?.ctimeMs]) !==
      JSON.stringify([after?.dev, after?.ino, after?.size, after?.mtimeMs, after?.ctimeMs])) {
      throw new Error("Files changed while capturing review evidence. Retry for a fresh snapshot.");
    }
    change.patch = patch;
    files.set(file, change);
  }
  const changes = [...files.values()];
  const headSha = (await exec(["rev-parse", "--verify", "HEAD"], root).catch(() => ({ stdout: "" }))).stdout.trim() || null;
  if (headSha !== initialHead) throw new Error("HEAD changed while capturing review evidence. Retry for a fresh snapshot.");
  const commits = options.commits ?? [];
  const id = `sha256:${contentHash.update(JSON.stringify([base, headSha, options.scope, options.branch, changes, commits])).digest("hex")}`;
  return { filesChanged: changes.length, files: changes, commits, branch: options.branch,
    insertions: changes.reduce((n, f) => n + f.insertions, 0), deletions: changes.reduce((n, f) => n + f.deletions, 0),
    snapshot: { id, capturedAt: Date.now(), baseSha: base, headSha, scope: options.scope,
      consistency: "sampled", contributionBinding: "unbound" } };
}
