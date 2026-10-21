import fs from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { libraryFixture, runtimeFixture, workspaceFixture, itemFixture, changeItem } from "./test-fixture.ts";
import { withLibrary, recordContextChanged } from "./store.ts";
import { recentLibraryActivity } from "./activity.ts";
let fixture: ReturnType<typeof libraryFixture>, runtime: ReturnType<typeof runtimeFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home); runtime = runtimeFixture(fixture.root); });
afterEach(() => { runtime.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
it("returns one latest event per requested project across work/context, including quiet projects", () => {
  const a = workspaceFixture(fixture.root, "A"), b = workspaceFixture(fixture.root, "B");
  itemFixture(runtime, a, "work", 100); changeItem(runtime, "work", { runtime: "working" }, 200);
  recordContextChanged(a.id, "Context update");
  const result = withLibrary(db => recentLibraryActivity(db, runtime, [a.id, b.id, a.id]));
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ projectId: a.id, recent: { projectId: a.id, text: "Project context updated", kind: "context" } });
  expect(result[1]).toMatchObject({ projectId: b.id, recent: null });
  expect(Date.parse(result[0]!.expiresAt)).toBeGreaterThan(Date.now());
});
it("keeps historical activity visible for missing sources without claiming runtime authority", () => {
  const a = workspaceFixture(fixture.root); recordContextChanged(a.id, "Recorded update");
  fs.rmSync(a.sourceRoot, { recursive: true });
  const result = withLibrary(db => recentLibraryActivity(db, runtime, [a.id]));
  expect(result[0]!.recent?.text).toBe("Project context updated");
  expect(result[0]).not.toHaveProperty("running");
});
it("rejects unknown project IDs, oversized batches and unavailable history", () => {
  const a = workspaceFixture(fixture.root);
  expect(() => withLibrary(db => recentLibraryActivity(db, runtime, ["foreign"]))).toThrow("Registered workspace");
  expect(() => withLibrary(db => recentLibraryActivity(db, runtime, Array.from({ length: 101 }, (_, i) => String(i))))).toThrow("100");
  expect(() => withLibrary(db => recentLibraryActivity(db, null, [a.id]))).toThrow("unavailable");
});

it("returns at most three distinct recent primary leader items, excluding children, other roles and archives", () => {
  const a = workspaceFixture(fixture.root), other = workspaceFixture(fixture.root);
  for (let i = 0; i < 6; i++) {
    itemFixture(runtime, a, `leader-${i}`, i + 1);
    runtime.prepare("INSERT INTO sessions(session_key, project_id, work_item_id, role, run_kind, run_number) VALUES (?, ?, ?, 'leader', 'primary', 1)").run(`run-${i}`, a.id, `leader-${i}`);
  }
  runtime.prepare("UPDATE work_items SET resolution='archived' WHERE id='leader-5'").run();
  runtime.prepare("UPDATE sessions SET role='default' WHERE session_key='run-4'").run();
  runtime.prepare("INSERT INTO sessions(session_key, project_id, work_item_id, role, run_kind, run_number, ended_at, run_outcome) VALUES ('old-run', ?, 'leader-3', 'leader', 'primary', 2, 1, 'completed')").run(a.id);
  itemFixture(runtime, a, "child-only", 100);
  runtime.prepare("INSERT INTO sessions(session_key, project_id, work_item_id, role, run_kind, parent_run_key, task_id, attempt_id, attempt_number) VALUES ('child', ?, 'child-only', 'leader', 'child', 'run-3', 'task', 'attempt', 1)").run(a.id);
  itemFixture(runtime, other, "foreign", 200);
  runtime.prepare("INSERT INTO sessions(session_key, project_id, work_item_id, role, run_kind, run_number) VALUES ('foreign', ?, 'foreign', 'leader', 'primary', 1)").run(other.id);
  const result = withLibrary(db => recentLibraryActivity(db, runtime, [a.id]))[0]!;
  expect(result.leaders.map(row => row.workItemId)).toEqual(["leader-3", "leader-2", "leader-1"]);
  expect(result.leaders[0]).toEqual({ workItemId: "leader-3", title: "Work leader-3", at: 4 });
  expect(Object.keys(result.leaders[0]!)).not.toContain("task_state_json");
});
