import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { exec } from "./worktree-exec.ts";
import { getWorkspaceDiff } from "./workspace-diff.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "leader-changes-"));
  roots.push(root);
  await exec(["init", "-b", "main"], root);
  await exec(["config", "user.name", "Test"], root);
  await exec(["config", "user.email", "test@example.test"], root);
  return root;
}

describe("live workspace changes", () => {
  it("reports staged, unstaged, deleted, binary and untracked files without changing the index", async () => {
    const root = await repo();
    await fs.writeFile(path.join(root, "modified.txt"), "old\n");
    await fs.writeFile(path.join(root, "deleted.txt"), "removed\n");
    await fs.writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
    await exec(["add", "."], root);
    await exec(["commit", "-m", "initial"], root);
    await fs.writeFile(path.join(root, "modified.txt"), "new\nextra\n");
    await fs.unlink(path.join(root, "deleted.txt"));
    await fs.writeFile(path.join(root, "staged.txt"), "staged\n");
    await exec(["add", "staged.txt"], root);
    await fs.writeFile(path.join(root, "new\tfile.txt"), "untracked\n");
    await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    await fs.writeFile(path.join(root, "ignored.txt"), "ignored\n");
    const before = await exec(["status", "--porcelain=v1", "-z"], root);
    const diff = await getWorkspaceDiff(root);
    expect(diff).toMatchObject({ filesChanged: 5, insertions: 4, deletions: 2, commits: [], branch: "main" });
    expect(diff.files).toEqual(expect.arrayContaining([
      { file: "modified.txt", status: "modified", insertions: 2, deletions: 1 },
      { file: "deleted.txt", status: "deleted", insertions: 0, deletions: 1 },
      { file: "staged.txt", status: "added", insertions: 1, deletions: 0 },
      { file: "new\tfile.txt", status: "added", insertions: 1, deletions: 0 },
      { file: "binary.bin", status: "added", insertions: 0, deletions: 0 },
    ]));
    expect(await exec(["status", "--porcelain=v1", "-z"], root)).toEqual(before);
  });

  it("includes files before the first commit and reads from the repository root", async () => {
    const root = await repo();
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "staged.txt"), "initial\n");
    await exec(["add", "staged.txt"], root);
    await fs.writeFile(path.join(root, "staged.txt"), "initial\nmore\n");
    await fs.writeFile(path.join(root, "new.txt"), "new\n");
    expect(await getWorkspaceDiff(path.join(root, "nested"))).toMatchObject({ filesChanged: 2, insertions: 3, deletions: 0 });
  });

  it("refuses an oversized file list before reading contents, including unborn repositories", async () => {
    const root = await repo();
    const hash = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "fixture\n", encoding: "utf8" }).trim();
    execFileSync("git", ["update-index", "--index-info"], {
      cwd: root, input: Array.from({ length: 10_001 }, (_, i) => `100644 ${hash}\tgenerated/${i}.txt\n`).join(""),
    });
    // Files intentionally do not exist: the limit must be checked before content scanning.
    await expect(getWorkspaceDiff(root)).rejects.toThrow("10001 candidate files exceeds the 10000-file review limit");
  });

  it("bounds untracked content reads and offers remediation rather than silently omitting files", async () => {
    const root = await repo();
    const file = await fs.open(path.join(root, "large.bin"), "w");
    await file.truncate(64 * 1024 * 1024 + 1);
    await file.close();
    await expect(getWorkspaceDiff(root)).rejects.toThrow("64 MiB untracked-content review limit");
    expect((await exec(["ls-files"], root)).stdout).toBe("");
  });

  it("applies the content budget across files, not just to each file individually", async () => {
    const root = await repo();
    for (const name of ["a.bin", "b.bin"]) {
      const file = await fs.open(path.join(root, name), "w");
      await file.truncate(33 * 1024 * 1024);
      await file.close();
    }
    await expect(getWorkspaceDiff(root)).rejects.toThrow("64 MiB untracked-content review limit");
  });

  it("preserves line counts across stream chunks, empty files, binary data and symlinks", async () => {
    const root = await repo();
    await fs.writeFile(path.join(root, "text.txt"), "🌍\r\n".repeat(20_000) + "tail");
    await fs.writeFile(path.join(root, "empty.txt"), "");
    await fs.writeFile(path.join(root, "binary.bin"), Buffer.concat([Buffer.alloc(70_000, 10), Buffer.from([0])]));
    await fs.symlink("text.txt", path.join(root, "link"));
    expect((await getWorkspaceDiff(root)).files).toEqual(expect.arrayContaining([
      { file: "text.txt", insertions: 20_001, deletions: 0, status: "added" },
      { file: "empty.txt", insertions: 0, deletions: 0, status: "added" },
      { file: "binary.bin", insertions: 0, deletions: 0, status: "added" },
      { file: "link", insertions: 1, deletions: 0, status: "added" },
    ]));
  });

  it("respects local generated-artifact exclusions without changing tracked changes", async () => {
    const root = await repo();
    await fs.writeFile(path.join(root, "tracked.txt"), "old\n");
    await exec(["add", "."], root);
    await exec(["commit", "-m", "initial"], root);
    await fs.writeFile(path.join(root, "tracked.txt"), "new\n");
    const file = await fs.open(path.join(root, "generated.bin"), "w");
    await file.truncate(64 * 1024 * 1024 + 1);
    await file.close();
    await fs.appendFile(path.join(root, ".git", "info", "exclude"), "\ngenerated.bin\n");
    expect(await getWorkspaceDiff(root)).toMatchObject({ filesChanged: 1, files: [
      { file: "tracked.txt", insertions: 1, deletions: 1, status: "modified" },
    ] });
  });

  it("returns an empty diff for a clean repository and reports non-repository errors", async () => {
    const root = await repo();
    await exec(["commit", "--allow-empty", "-m", "initial"], root);
    expect(await getWorkspaceDiff(root)).toMatchObject({ filesChanged: 0, files: [] });
    await fs.rm(path.join(root, ".git"), { recursive: true });
    await expect(getWorkspaceDiff(root)).rejects.toThrow("git rev-parse");
  });
});
