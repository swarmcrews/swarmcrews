import fs from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { libraryFixture, runtimeFixture, workspaceFixture, quietRuntime, itemFixture, changeItem } from "./test-fixture.ts";
import { withLibrary, listLibrary, setFocus } from "./store.ts";
import { archiveProject, summarizeLibrary, restoreProject } from "./summary.ts";
import { scanMissingProjects, cleanupMissingProjects, sourceIsMissing } from "./cleanup.ts";
let fixture: ReturnType<typeof libraryFixture>; let runtime: ReturnType<typeof runtimeFixture>;
let workspace: ReturnType<typeof workspaceFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home); runtime = runtimeFixture(fixture.root); workspace = workspaceFixture(fixture.root); });
afterEach(() => { runtime.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
const scan = () => withLibrary(db => scanMissingProjects(db, runtime, quietRuntime, [workspace.id]));
const clean = (revision = 0) => withLibrary(db => cleanupMissingProjects(db, runtime, quietRuntime, [{ id: workspace.id, expectedRevision: revision }]));
const missing = () => fs.rmSync(workspace.sourceRoot, { recursive: true });
it("scans only missing unarchived folders and reversibly archives without losing history or identity", () => {
  expect(scan()).toEqual([]); itemFixture(runtime, workspace, "work");
  changeItem(runtime, "work", { runtime: "inactive", outcome: "completed", resolution: "reviewed" });
  withLibrary(db => setFocus(db, [workspace.id], 0)); const before = runtime.prepare("SELECT * FROM work_items").all();
  missing(); expect(scan()).toEqual([{ id: workspace.id, revision: 1, eligible: true }]);
  expect(clean(1)).toEqual({ archived: [workspace.id], skipped: [] });
  expect(withLibrary(listLibrary).projects[0]).toMatchObject({ archived: true, focusOrder: null, revision: 2 });
  expect(scan()).toEqual([]); expect(runtime.prepare("SELECT * FROM work_items").all()).toEqual(before);
  expect(withLibrary(db => restoreProject(db, workspace.id, 2))).toMatchObject({ archived: false, id: workspace.id });
  expect(fs.existsSync(workspace.stateRoot)).toBe(true);
});
it("keeps ordinary summary and archive conservative for missing folders", () => {
  missing(); expect(withLibrary(db => summarizeLibrary(db, runtime, quietRuntime, [workspace.id]))[0]).toMatchObject({ freshness: "unknown", archiveEligible: false });
  expect(() => withLibrary(db => archiveProject(db, runtime, quietRuntime, workspace.id, 0))).toThrow("blocks archive");
});
it("rechecks restored folders, revisions and active work after preview", () => {
  missing(); expect(scan()[0]?.eligible).toBe(true);
  fs.mkdirSync(workspace.sourceRoot); expect(clean().skipped[0]?.reason).toMatch(/missing/);
  missing(); expect(clean(99).skipped[0]?.reason).toMatch(/changed/);
  itemFixture(runtime, workspace, "work"); changeItem(runtime, "work", { runtime: "working" });
  expect(clean().skipped[0]?.reason).toMatch(/work/); expect(scan()[0]?.eligible).toBe(false);
  changeItem(runtime, "work", { runtime: "inactive", outcome: "completed" }); expect(scan()[0]?.eligible).toBe(false);
  expect(withLibrary(listLibrary).projects[0]?.archived).toBe(false);
});
it("blocks unknown runtime, symlinks, files, and permission errors instead of interpreting them as missing", () => {
  missing();
  expect(withLibrary(db => cleanupMissingProjects(db, null, quietRuntime, [{ id: workspace.id, expectedRevision: 0 }])).archived).toEqual([]);
  expect(withLibrary(db => scanMissingProjects(db, runtime, undefined, [workspace.id]))[0]?.eligible).toBe(false);
  fs.symlinkSync(fixture.root + "/absent-target", workspace.sourceRoot); expect(sourceIsMissing(workspace.sourceRoot)).toBe(false);
  fs.unlinkSync(workspace.sourceRoot); fs.writeFileSync(workspace.sourceRoot, "not a directory"); expect(sourceIsMissing(workspace.sourceRoot)).toBe(false);
  const spy = vi.spyOn(fs, "lstatSync").mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EACCES" }); });
  expect(sourceIsMissing(workspace.sourceRoot)).toBe(false); spy.mockRestore();
});
it("rechecks absence after the runtime read and holds the durable write fence", () => {
  missing();
  const other = runtimeFixture(fixture.root); other.pragma("busy_timeout = 0");
  const reader = (ids: string[]) => {
    expect(() => other.prepare("INSERT INTO sessions(session_key,project_id,status) VALUES ('race',?,'running')").run(workspace.id)).toThrow(/locked/);
    fs.mkdirSync(workspace.sourceRoot); return quietRuntime(ids);
  };
  const result = withLibrary(db => cleanupMissingProjects(db, runtime, reader, [{ id: workspace.id, expectedRevision: 0 }]));
  expect(result).toEqual({ archived: [], skipped: [{ id: workspace.id, reason: expect.stringMatching(/changed/) }] });
  expect(withLibrary(listLibrary).projects[0]?.archived).toBe(false); other.close();
});
