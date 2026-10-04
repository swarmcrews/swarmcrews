import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exec } from "./worktree-exec.ts";
import { safeReviewPath } from "./review-diff.ts";
import { getWorkspaceDiff } from "./workspace-diff.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-patches-")); roots.push(root);
  await exec(["init", "-b", "main"], root);
  await exec(["config", "user.name", "Test"], root);
  await exec(["config", "user.email", "test@example.test"], root);
  return root;
}
describe("read-only patch evidence", () => {
  it("captures actual patches and stable content identity without touching the index", async () => {
    const root = await repo();
    await fs.writeFile(path.join(root, "old.txt"), "before\n");
    await fs.writeFile(path.join(root, "deleted.txt"), "gone\n");
    await exec(["add", "."], root); await exec(["commit", "-m", "base"], root);
    await exec(["mv", "old.txt", "new.txt"], root);
    await fs.unlink(path.join(root, "deleted.txt"));
    await fs.writeFile(path.join(root, "new\tfile.txt"), "added\n");
    await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1]));
    await fs.writeFile(path.join(root, "large.txt"), "x".repeat(600_000));
    const before = (await exec(["status", "--porcelain=v1", "-z"], root)).stdout;
    const diff = await getWorkspaceDiff(root);
    expect(diff.files.find(f => f.file === "new.txt")).toMatchObject({ status: "renamed", previousFile: "old.txt", patch: { state: "text", text: expect.stringContaining("rename from old.txt") } });
    expect(diff.files.find(f => f.file === "deleted.txt")).toMatchObject({ status: "deleted", patch: { text: expect.stringContaining("-gone") } });
    expect(diff.files.find(f => f.file === "new\tfile.txt")).toMatchObject({ patch: { state: "text", text: expect.stringContaining("+added") } });
    expect(diff.files.find(f => f.file === "binary.bin")).toMatchObject({ patch: { state: "binary" } });
    expect(diff.files.find(f => f.file === "large.txt")).toMatchObject({ patch: { state: "large" } });
    expect(diff.snapshot).toMatchObject({ id: expect.stringMatching(/^sha256:/), scope: "workspace", baseSha: expect.stringMatching(/^[a-f0-9]{40}$/), contributionBinding: "unbound" });
    expect((await getWorkspaceDiff(root)).snapshot?.id).toBe(diff.snapshot?.id);
    await fs.appendFile(path.join(root, "new\tfile.txt"), "later\n");
    expect((await getWorkspaceDiff(root)).snapshot?.id).not.toBe(diff.snapshot?.id);
    expect((await exec(["status", "--porcelain=v1", "-z"], root)).stdout).toBe(before);
  });
  it("shows symlink text rather than reading the external target", async () => {
    const root = await repo(); const outside = await repo();
    await fs.writeFile(path.join(outside, "secret"), "NEVER DISCLOSE\n");
    await fs.symlink(path.join(outside, "secret"), path.join(root, "link"));
    const diff = await getWorkspaceDiff(root);
    expect(diff.files[0]?.patch?.text).toContain(path.join(outside, "secret"));
    expect(JSON.stringify(diff)).not.toContain("NEVER DISCLOSE");
  });
  it("keeps long and newline paths literal and bounds the combined patch payload", async () => {
    const root = await repo();
    const directory = "long".repeat(35); await fs.mkdir(path.join(root, directory));
    await fs.writeFile(path.join(root, directory, "line\nbreak.txt"), "literal\n");
    for (let i = 0; i < 24; i++) await fs.writeFile(path.join(root, `file-${i}.txt`), "a\n".repeat(20_000));
    const diff = await getWorkspaceDiff(root);
    expect(diff.files.some(f => f.file === `${directory}/line\nbreak.txt`)).toBe(true);
    expect(diff.files.reduce((sum, file) => sum + Buffer.byteLength(file.patch?.text ?? ""), 0)).toBeLessThanOrEqual(1024 * 1024);
    expect(diff.files.some(f => f.patch?.state === "large")).toBe(true);
  });
});

it("rejects traversal and symlink ancestors, even for tracked paths", async () => {
  const root = await repo(); const outside = await repo();
  await expect(safeReviewPath(root, "../outside")).rejects.toThrow("Unsafe review path");
  await expect(safeReviewPath(root, "/etc/passwd")).rejects.toThrow("Unsafe review path");
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "nested", "tracked.txt"), "original\n");
  await exec(["add", "."], root); await exec(["commit", "-m", "base"], root);
  await fs.writeFile(path.join(outside, "tracked.txt"), "DO NOT READ\n");
  await fs.rm(path.join(root, "nested"), { recursive: true }); await fs.symlink(outside, path.join(root, "nested"));
  await expect(safeReviewPath(root, "nested/tracked.txt")).rejects.toThrow("directory symlink");
  await expect(getWorkspaceDiff(root)).rejects.toThrow("directory symlink");
});
it("treats tracked wildcard paths literally and never executes external diff helpers", async () => {
  const root = await repo();
  for (const name of ["literal*.txt", "sibling.txt"]) await fs.writeFile(path.join(root, name), "old\n");
  await exec(["add", "."], root); await exec(["commit", "-m", "base"], root);
  await fs.writeFile(path.join(root, "literal*.txt"), "literal new\n");
  await fs.writeFile(path.join(root, "sibling.txt"), "sibling new\n");
  await exec(["config", "diff.external", "must-not-execute"], root);
  const diff = await getWorkspaceDiff(root);
  expect(diff.files.find(f => f.file === "literal*.txt")?.patch?.text).toContain("+literal new");
  expect(diff.files.find(f => f.file === "literal*.txt")?.patch?.text).not.toContain("sibling new");
});

it("bounds inline line counts so tiny-line files cannot flood the patch renderer", async () => {
  const root = await repo();
  await fs.writeFile(path.join(root, "many-lines.txt"), "a\n".repeat(2500));
  expect((await getWorkspaceDiff(root)).files[0]?.patch).toMatchObject({ state: "large", reason: expect.stringContaining("2000-line") });
});
