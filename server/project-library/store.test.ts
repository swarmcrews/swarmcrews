import fs from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { registerWorkspace, resolveWorkspace, rebindWorkspace } from "../workspace-registry.ts";
import { withLibrary, listLibrary, patchMetadata, setFocus, createCollection, deleteCollection, recordOpened, recordOpenedIfAvailable, recordContextChanged, authorizeWorkspace } from "./store.ts";
import { libraryFixture, workspaceFixture } from "./test-fixture.ts";

let fixture: ReturnType<typeof libraryFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home); });
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });

describe("durable UUID Library organization", () => {
  it("keeps every registered project beyond 20 recents and persists metadata across connection reopen", () => {
    const projects = Array.from({ length: 25 }, (_, i) => workspaceFixture(fixture.root, `Project ${i}`));
    recordOpened(projects[0]!.id, "2026-01-01T00:00:00Z");
    const collection = withLibrary(db => createCollection(db, "Clients"));
    withLibrary(db => patchMetadata(db, projects[0]!.id, { expectedRevision: 0, displayName: "Short label",
      description: "Notes", tags: ["backend", "backend"], collectionIds: [collection.id] }));
    const reopened = withLibrary(listLibrary);
    expect(reopened.projects).toHaveLength(25);
    expect(reopened.projects.find(p => p.id === projects[0]!.id)).toMatchObject({ name: "Short label", tags: ["backend"],
      description: "Notes", collectionIds: [collection.id], lastOpened: "2026-01-01T00:00:00Z", revision: 1 });
    expect(registerWorkspace(projects[0]!.sourceRoot)!.id).toBe(projects[0]!.id);
    expect(resolveWorkspace(projects[0]!.id)!.stateRoot).toBe(projects[0]!.stateRoot);
    expect(fs.readFileSync(path.join(projects[0]!.sourceRoot, "keep.txt"), "utf8")).toBe("Preserve source");
  });
  it("orders Focus with CAS, rejects duplicates/foreign IDs, and deletes collection membership only", () => {
    const a = workspaceFixture(fixture.root); const b = workspaceFixture(fixture.root);
    const group = withLibrary(db => createCollection(db, "Group"));
    withLibrary(db => patchMetadata(db, a.id, { expectedRevision: 0, collectionIds: [group.id] }));
    const desk = withLibrary(db => setFocus(db, [b.id, a.id], 0));
    expect(desk.focusRevision).toBe(1);
    expect(desk.projects.find(p => p.id === b.id)!.focusOrder).toBe(0);
    expect(desk.projects.find(p => p.id === a.id)!.focusOrder).toBe(1);
    expect(() => withLibrary(db => setFocus(db, [], 0))).toThrow("Organization changed");
    expect(() => withLibrary(db => setFocus(db, [a.id, a.id], 1))).toThrow("unique");
    expect(() => withLibrary(db => setFocus(db, ["11111111-1111-4111-8111-111111111111"], 1))).toThrow("Registered workspace");
    withLibrary(db => deleteCollection(db, group.id));
    const after = withLibrary(listLibrary);
    expect(after.projects).toHaveLength(2); expect(after.collections).toEqual([]);
    expect(after.projects.find(p => p.id === a.id)).toMatchObject({ collectionIds: [], focusOrder: 1, archived: false });
    expect(() => withLibrary(db => patchMetadata(db, a.id, { expectedRevision: 1, tags: ["stale"] }))).toThrow("Organization changed");
    const removed = withLibrary(db => setFocus(db, [], 1));
    expect(removed.projects.every(p => !p.archived && p.focusOrder === null)).toBe(true);
  });
  it("preserves metadata through explicit rebind and rejects source symlink replacement/traversal", () => {
    const a = workspaceFixture(fixture.root); const b = workspaceFixture(fixture.root);
    withLibrary(db => patchMetadata(db, a.id, { expectedRevision: 0, tags: ["stable"] }));
    const newPath = fs.mkdtempSync(path.join(fixture.root, "new-"));
    expect(rebindWorkspace(a.id, newPath)).not.toBeNull();
    expect(withLibrary(listLibrary).projects.find(p => p.id === a.id)).toMatchObject({ sourceRoot: newPath, tags: ["stable"] });
    fs.rmdirSync(newPath); fs.symlinkSync(b.sourceRoot, newPath, "dir");
    expect(() => authorizeWorkspace(a.id)).toThrow("Explicit source rebind");
    expect(() => authorizeWorkspace("../" + a.id)).toThrow("Registered workspace");
    expect(() => authorizeWorkspace(Buffer.from(b.sourceRoot).toString("base64url"))).toThrow("Registered workspace");
  });
  it("records context once per actual changed content and never stores context body", () => {
    const a = workspaceFixture(fixture.root);
    recordContextChanged(a.id, "secret text"); recordContextChanged(a.id, "secret text"); recordContextChanged(a.id, "new text");
    const rows = withLibrary(db => db.prepare("SELECT * FROM library_context_events").all());
    expect(rows).toHaveLength(2); expect(JSON.stringify(rows)).not.toContain("secret text");
    expect(JSON.stringify(rows)).toContain("Project context updated");
  });
  it("fails closed for corrupt/symlink persistence without overwriting it", () => {
    const target = path.join(fixture.root, "sentinel"); fs.writeFileSync(target, "do not overwrite");
    fs.symlinkSync(target, path.join(fixture.home, "project-library.db"));
    expect(() => withLibrary(listLibrary)).toThrow("symlink");
    expect(fs.readFileSync(target, "utf8")).toBe("do not overwrite");
  });
});


it("validates opening identity before corrupt optional storage, while strict writes still fail", () => {
  const workspace = workspaceFixture(fixture.root);
  const file = path.join(fixture.home, "project-library.db");
  const corrupt = Buffer.from("not SQLite: keep these bytes");
  fs.writeFileSync(file, corrupt);
  expect(() => recordOpened("11111111-1111-4111-8111-111111111111")).toThrow("Registered workspace");
  expect(() => recordOpened("../" + workspace.id)).toThrow("Registered workspace");
  expect(() => recordOpened(workspace.id)).toThrow(Database.SqliteError);
  expect(() => recordOpenedIfAvailable(workspace.id)).not.toThrow();
  expect(() => recordOpenedIfAvailable("11111111-1111-4111-8111-111111111111")).toThrow("Registered workspace");
  expect(() => recordOpenedIfAvailable("../" + workspace.id)).toThrow("Registered workspace");
  expect(() => recordContextChanged(workspace.id, "unchanged strict context recording")).toThrow(Database.SqliteError);
  const other = workspaceFixture(fixture.root);
  fs.renameSync(workspace.sourceRoot, workspace.sourceRoot + "-old");
  fs.symlinkSync(other.sourceRoot, workspace.sourceRoot, "dir");
  expect(() => recordOpened(workspace.id)).toThrow("Explicit source rebind");
  expect(() => recordOpenedIfAvailable(workspace.id)).toThrow("Explicit source rebind");
  expect(fs.readFileSync(file)).toEqual(corrupt);
});


it("records optional opening history normally and keeps last-opened monotonic", () => {
  const workspace = workspaceFixture(fixture.root);
  recordOpenedIfAvailable(workspace.id, "2026-02-01T00:00:00Z");
  recordOpenedIfAvailable(workspace.id, "2026-01-01T00:00:00Z");
  expect(withLibrary(listLibrary).projects[0]!.lastOpened).toBe("2026-02-01T00:00:00Z");
});

it("does not classify Library symlinks or unrelated SQL failures as optional storage outages", () => {
  const workspace = workspaceFixture(fixture.root);
  const file = path.join(fixture.home, "project-library.db");
  const target = path.join(fixture.root, "sentinel");
  fs.writeFileSync(target, "preserve the target"); fs.symlinkSync(target, file);
  expect(() => recordOpenedIfAvailable(workspace.id)).toThrow("symlink");
  expect(fs.readFileSync(target, "utf8")).toBe("preserve the target");
  fs.unlinkSync(file);
  const missing = path.join(fixture.root, "missing-symlink-target");
  fs.symlinkSync(missing, file);
  expect(() => recordOpenedIfAvailable(workspace.id)).toThrow("symlink");
  expect(fs.existsSync(missing)).toBe(false);
  fs.unlinkSync(file);
  const db = new Database(file);
  db.exec("CREATE TABLE library_projects (wrong_schema TEXT)"); db.close();
  expect(() => recordOpenedIfAvailable(workspace.id)).toThrow("no column named id");
});

it("does not classify a symlink Library home as an optional storage outage", () => {
  const workspace = workspaceFixture(fixture.root);
  const realHome = fixture.home + "-real";
  fs.renameSync(fixture.home, realHome); fs.symlinkSync(realHome, fixture.home, "dir");
  expect(() => recordOpenedIfAvailable(workspace.id)).toThrow("Library home must be a real directory");
  expect(fs.existsSync(path.join(realHome, "project-library.db"))).toBe(false);
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("does not swallow real Library file permission failures", () => {
  const workspace = workspaceFixture(fixture.root);
  recordOpened(workspace.id);
  const file = path.join(fixture.home, "project-library.db");
  fs.chmodSync(file, 0);
  try {
    expect(() => recordOpenedIfAvailable(workspace.id)).toThrow(Database.SqliteError);
  } finally { fs.chmodSync(file, 0o600); }
});
