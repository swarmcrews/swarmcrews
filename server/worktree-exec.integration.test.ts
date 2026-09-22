import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { exec } from "./worktree-exec.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

it("reads a real Git NUL-delimited listing larger than Node's default 1 MiB buffer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-large-list-"));
  roots.push(root);
  await exec(["init", "-b", "main"], root);
  const hash = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: root, input: "fixture\n", encoding: "utf8" }).trim();
  // Populate only the index: a portable large-output fixture without thousands of disk files.
  const names = Array.from({ length: 6000 }, (_, i) => `files/${"x".repeat(180)}-${i}.txt`);
  execFileSync("git", ["update-index", "--index-info"], {
    cwd: root, input: names.map(name => `100644 ${hash}\t${name}\n`).join(""),
  });
  const expected = names.sort().join("\0") + "\0";
  expect(Buffer.byteLength(expected)).toBeGreaterThan(1024 * 1024);
  expect((await exec(["ls-files", "-z"], root)).stdout).toBe(expected);
});

it("rejects real output above the safety ceiling without exposing partial stdout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "git-output-limit-"));
  roots.push(root);
  await exec(["init", "-b", "main"], root);
  const hash = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: root, input: Buffer.alloc(16 * 1024 * 1024 + 1, 120), encoding: "utf8",
  }).trim();
  const error = await exec(["cat-file", "blob", hash], root).catch(error => error as Error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("output exceeded the 16 MiB safety limit");
  expect((error as Error).message.length).toBeLessThan(300);
});
