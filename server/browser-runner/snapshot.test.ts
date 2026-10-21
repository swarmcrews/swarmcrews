import { mkdtemp, writeFile, mkdir, rm, symlink, readFile, truncate, link, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { snapshotSource } from "./snapshot.ts";
const dirs: string[] = [];
const nativeIt = it.skipIf(process.platform !== "linux");
async function root() { const dir = await mkdtemp(join(tmpdir(), "browser-source-test-")); dirs.push(dir); return dir; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
nativeIt("copies dirty files, hashes content, omits dependencies/metadata/secrets and never mutates source", async () => {
  const cwd = await root(); await writeFile(join(cwd, "test.js"), "hello"); await writeFile(join(cwd, ".env.local"), "secret");
  await mkdir(join(cwd, "node_modules")); await symlink("/etc", join(cwd, "node_modules", "external"));
  const first = await snapshotSource(cwd, new AbortController().signal); dirs.push(first.directory);
  expect(await readFile(join(first.directory, "test.js"), "utf8")).toBe("hello");
  await expect(readFile(join(first.directory, ".env.local"))).rejects.toThrow();
  await writeFile(join(cwd, "test.js"), "changed");
  const second = await snapshotSource(cwd, new AbortController().signal); dirs.push(second.directory);
  expect(second.digest).not.toBe(first.digest);
  expect(await readFile(join(first.directory, "test.js"), "utf8")).toBe("hello");
});
nativeIt("rejects symlink traversal and aborted snapshots", async () => {
  const cwd = await root(); await symlink("/etc/passwd", join(cwd, "escape"));
  await expect(snapshotSource(cwd, new AbortController().signal)).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(snapshotSource(cwd, controller.signal)).rejects.toThrow();
});
nativeIt("includes empty directory structure in snapshot identity", async () => {
  const cwd = await root(); const first = await snapshotSource(cwd, new AbortController().signal); dirs.push(first.directory);
  await mkdir(join(cwd, "empty"));
  const second = await snapshotSource(cwd, new AbortController().signal); dirs.push(second.directory);
  expect(second.digest).not.toBe(first.digest);
});
nativeIt("omits root runtime/recovery state before opening large files or unsafe entries", async () => {
  const cwd = await root(); await writeFile(join(cwd, "source.ts"), "dirty source");
  for (const name of [".run", ".canvas-worktrees", ".context", ".recovery", ".stryker-tmp", "__dag_verify__"]) {
    await mkdir(join(cwd, name)); await writeFile(join(cwd, name, "local.log"), "retained");
    await truncate(join(cwd, name, "local.log"), 17 * 1024 * 1024);
  }
  for (const name of [".minions-mcp-launch-secret", ".swarmcrews-session-secret"]) await symlink("/etc", join(cwd, name));
  const snapshot = await snapshotSource(cwd, new AbortController().signal); dirs.push(snapshot.directory);
  expect(await readdir(snapshot.directory)).toEqual(["source.ts"]);
  expect(await readFile(join(cwd, "source.ts"), "utf8")).toBe("dirty source");
  expect(await readFile(join(cwd, ".run", "local.log")).then(b => b.length)).toBe(17 * 1024 * 1024);
});
nativeIt("keeps generic root artifacts by default and makes operator exclusions root-only", async () => {
  const cwd = await root();
  for (const name of ["artifacts", "build", "designs", "tests/fixtures/artifacts", "src/build", "src/.run"]) {
    await mkdir(join(cwd, name), { recursive: true }); await writeFile(join(cwd, name, "input.txt"), name);
  }
  await writeFile(join(cwd, ".gitignore"), "src/\nartifacts/\n");
  const first = await snapshotSource(cwd, new AbortController().signal); dirs.push(first.directory);
  expect(await readFile(join(first.directory, "artifacts/input.txt"), "utf8")).toBe("artifacts");
  expect(await readFile(join(first.directory, "build/input.txt"), "utf8")).toBe("build");
  const second = await snapshotSource(cwd, new AbortController().signal, ["artifacts", "build", "designs"]); dirs.push(second.directory);
  expect(second.digest).not.toBe(first.digest);
  for (const name of ["artifacts", "build", "designs"]) await expect(readFile(join(second.directory, name, "input.txt"))).rejects.toThrow();
  for (const name of ["tests/fixtures/artifacts", "src/build", "src/.run"]) {
    expect(await readFile(join(second.directory, name, "input.txt"), "utf8")).toBe(name);
  }
});
nativeIt("keeps size, hardlink and included-symlink rejection even with operator exclusions", async () => {
  const cwd = await root(); await mkdir(join(cwd, "artifacts"));
  await writeFile(join(cwd, "artifacts", "huge"), ""); await truncate(join(cwd, "artifacts", "huge"), 17 * 1024 * 1024);
  await expect(snapshotSource(cwd, new AbortController().signal)).rejects.toThrow("byte limit");
  await writeFile(join(cwd, "source"), "included"); await link(join(cwd, "source"), join(cwd, "other-source"));
  await expect(snapshotSource(cwd, new AbortController().signal, ["artifacts"])).rejects.toThrow("hardlinks");
  await rm(join(cwd, "other-source")); await symlink("/etc/passwd", join(cwd, "source-link"));
  await expect(snapshotSource(cwd, new AbortController().signal, ["artifacts"])).rejects.toThrow();
});
nativeIt.each([".", "..", "src/fixtures", "../secret", "nested\\path", "*.log", "", "[abc]", "bad\0name"])("rejects invalid configured root exclusion %j", async name => {
  const cwd = await root();
  await expect(snapshotSource(cwd, new AbortController().signal, [name])).rejects.toThrow();
});
