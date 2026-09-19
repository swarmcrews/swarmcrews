import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverRepositoryDirectories } from "./repository-directory-discovery.ts";

let root: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "minions-browse-root-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "minions-browse-outside-"));
  vi.stubEnv("SWARMCREWS_BROWSE_ROOTS", JSON.stringify([root]));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("discoverRepositoryDirectories", () => {
  it("accepts an explicitly configured alias and returns canonical navigation paths", async () => {
    const alias = path.join(outside, "allowed-alias");
    fs.symlinkSync(root, alias, "junction");
    fs.mkdirSync(path.join(root, "Résumé project"));
    vi.stubEnv("SWARMCREWS_BROWSE_ROOTS", JSON.stringify([alias]));
    const result = await discoverRepositoryDirectories({ path: alias, mode: "browse" });
    expect(result?.directory).toBe(fs.realpathSync(root));
    expect(result?.entries[0]?.path).toBe(path.join(fs.realpathSync(root), "Résumé project"));
    expect(await discoverRepositoryDirectories({ path: result!.entries[0]!.path, mode: "browse" }))
      .toMatchObject({ parent: fs.realpathSync(root) });
  });

  it("caps results and can narrow a truncated listing", async () => {
    for (let i = 0; i < 105; i++) fs.mkdirSync(path.join(root, `repo-${String(i).padStart(3, "0")}`));
    const all = await discoverRepositoryDirectories({ path: root, mode: "browse" });
    expect(all?.entries).toHaveLength(100);
    expect(all?.truncated).toBe(true);
    const narrowed = await discoverRepositoryDirectories({ path: path.join(root, "repo-104"), mode: "complete" });
    expect(narrowed?.entries).toEqual([{ name: "repo-104", path: path.join(fs.realpathSync(root), "repo-104") }]);
  });

  it("completes the folder itself until a separator requests its children", async () => {
    const folder = path.join(root, "repo");
    fs.mkdirSync(path.join(folder, "child"), { recursive: true });
    expect((await discoverRepositoryDirectories({ path: folder }))?.entries.map((entry) => entry.name)).toEqual(["repo"]);
    expect((await discoverRepositoryDirectories({ path: `${folder}${path.sep}` }))?.entries.map((entry) => entry.name)).toEqual(["child"]);
    expect((await discoverRepositoryDirectories({ path: `"${folder}${path.sep}"` }))?.entries.map((entry) => entry.name)).toEqual(["child"]);
  });

  it("does not stat targets outside the configured real roots", async () => {
    fs.symlinkSync(outside, path.join(root, "escape"), "junction");
    const stat = vi.spyOn(fs.promises, "stat");
    await discoverRepositoryDirectories({ path: path.join(root, "escape"), mode: "browse" });
    expect(stat.mock.calls.map(([p]) => p)).not.toContain(fs.realpathSync(outside));
  });

  it("only returns configured directories with shallow prefix completion", async () => {
    fs.mkdirSync(path.join(root, "alpha"));
    fs.mkdirSync(path.join(root, "Alpine"));
    fs.writeFileSync(path.join(root, "alphanumeric-file"), "not a directory");
    const result = await discoverRepositoryDirectories({ path: path.join(root, "al"), mode: "complete" });
    expect(result).toMatchObject({ directory: fs.realpathSync(root), parent: null, truncated: false });
    expect(result?.entries.map((entry) => entry.name)).toEqual(["alpha", "Alpine"]);
    expect(result?.breadcrumbs).toEqual([{ name: path.basename(root), path: fs.realpathSync(root) }]);
    expect((await discoverRepositoryDirectories({ path: path.join(root, "al") }))?.entries)
      .toEqual(result?.entries);
  });

  it("returns configured roots without probing a path for an empty request", async () => {
    const result = await discoverRepositoryDirectories({ mode: "browse" });
    expect(result).toMatchObject({ directory: null, parent: null, entries: [] });
    expect(result?.roots).toEqual([{ name: path.basename(root), path: fs.realpathSync(root) }]);
  });

  it("rejects traversal and symlink escapes without exposing outside entries", async () => {
    fs.mkdirSync(path.join(outside, "secret"));
    fs.symlinkSync(outside, path.join(root, "escape"), "junction");
    expect(await discoverRepositoryDirectories({ path: path.join(root, "..", path.basename(outside)), mode: "browse" })).toBeNull();
    expect(await discoverRepositoryDirectories({ path: path.join(root, "escape"), mode: "browse" })).toBeNull();
    const result = await discoverRepositoryDirectories({ path: root, mode: "browse" });
    expect(result?.entries.map((entry) => entry.name)).not.toContain("escape");
  });

  it("fails closed for malformed or inaccessible configured roots", async () => {
    vi.stubEnv("SWARMCREWS_BROWSE_ROOTS", "not json");
    expect(await discoverRepositoryDirectories({ mode: "browse" })).toMatchObject({ roots: [] });
    vi.stubEnv("SWARMCREWS_BROWSE_ROOTS", JSON.stringify([path.join(root, "missing")]));
    expect(await discoverRepositoryDirectories({ mode: "browse" })).toMatchObject({ roots: [] });
  });
});
