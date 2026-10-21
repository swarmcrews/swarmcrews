import fs from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { libraryFixture, runtimeFixture, workspaceFixture, itemFixture, changeItem, quietRuntime } from "./test-fixture.ts";
import { withLibrary, recordContextChanged } from "./store.ts";
import { summarizeLibrary } from "./summary.ts";
import { acknowledgeEvents, listEvents } from "./events.ts";
import { acknowledgeAll, unreadOverview } from "./read-state.ts";

let fixture: ReturnType<typeof libraryFixture>, runtime: ReturnType<typeof runtimeFixture>, workspace: ReturnType<typeof workspaceFixture>;
beforeEach(() => {
  fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home);
  runtime = runtimeFixture(fixture.root); workspace = workspaceFixture(fixture.root);
});
afterEach(() => { runtime.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
const page = (cursor?: string, limit = 50) => withLibrary(db => listEvents(db, runtime, workspace.id, cursor, limit));
const summary = () => withLibrary(db => summarizeLibrary(db, runtime, quietRuntime, [workspace.id])[0]!);
const overview = () => withLibrary(db => unreadOverview(db, runtime));
function primary(id: string, run = 1) {
  runtime.prepare(`INSERT INTO sessions(session_key,project_id,work_item_id,role,run_kind,run_number,ended_at,run_outcome)
    VALUES (?, ?, ?, 'leader', 'primary', ?, 1, 'completed')`).run(`${id}-${run}`, workspace.id, id, run);
}

it("counts leader conversations, not lifecycle events, continuations, drafts or child-only work", () => {
  overview(); // Install the projection before changes, like a running server.
  itemFixture(runtime, workspace, "leader", 100); primary("leader"); primary("leader", 2);
  changeItem(runtime, "leader", { runtime: "working" }, 200);
  changeItem(runtime, "leader", { runtime: "inactive", outcome: "completed" }, 300);
  itemFixture(runtime, workspace, "draft", 400);
  itemFixture(runtime, workspace, "child-only", 500);
  runtime.prepare(`INSERT INTO sessions(session_key,project_id,work_item_id,role,run_kind,parent_run_key,task_id,attempt_id,attempt_number,ended_at,run_outcome)
    VALUES ('child', ?, 'child-only', 'leader', 'child', 'leader-1', 'task', 'attempt', 1, 1, 'completed')`).run(workspace.id);
  itemFixture(runtime, workspace, "standalone", 600);
  runtime.prepare(`INSERT INTO sessions(session_key,project_id,work_item_id,role,run_kind,run_number,ended_at,run_outcome)
    VALUES ('standalone', ?, 'standalone', 'minion', 'primary', 1, 1, 'completed')`).run(workspace.id);
  expect(summary().unread).toBe(1);
  expect(overview()).toMatchObject({ total: 1, projects: 1 });
  expect(page().events).toEqual([expect.objectContaining({ workItemId: "leader", at: 300, unread: true })]);
  recordContextChanged(workspace.id, "Context changed");
  expect(summary().unread).toBe(2);
  expect(overview().total).toBe(2);
  expect(page().events.map(e => e.kind)).toEqual(["context", "work_item"]);
});

it("marks a leader read once, without resurfacing older transitions or clearing concurrent updates", () => {
  overview();
  itemFixture(runtime, workspace, "leader", 100); primary("leader");
  changeItem(runtime, "leader", { runtime: "working" }, 200);
  const shown = page();
  changeItem(runtime, "leader", { runtime: "inactive", outcome: "completed" }, 300);
  withLibrary(db => acknowledgeEvents(db, runtime, workspace.id, { receipt: shown.receipt, events: shown.events }));
  expect(summary().unread).toBe(1);
  const current = page();
  withLibrary(db => acknowledgeEvents(db, runtime, workspace.id, { receipt: current.receipt, events: current.events }));
  expect(summary().unread).toBe(0); expect(overview().total).toBe(0);
  expect(page().events).toHaveLength(1); expect(page().events[0]!.unread).toBe(false);
  changeItem(runtime, "leader", { outcome: "error" }, 400);
  expect(summary().unread).toBe(1);
});

it("paginates unique leaders and reports bulk clears in the same units as the unread count", () => {
  overview();
  for (let i = 0; i < 4; i++) {
    itemFixture(runtime, workspace, `leader-${i}`, 100); primary(`leader-${i}`);
    changeItem(runtime, `leader-${i}`, { runtime: "working" }, 200);
    changeItem(runtime, `leader-${i}`, { runtime: "inactive", outcome: "completed" }, 300);
  }
  const first = page(undefined, 2), second = page(first.nextCursor!, 2);
  expect(first.events).toHaveLength(2); expect(second.events).toHaveLength(2);
  expect(new Set([...first.events, ...second.events].map(e => e.workItemId)).size).toBe(4);
  expect(second.nextCursor).toBeNull();
  const { asOf, total } = overview(); expect(total).toBe(4);
  changeItem(runtime, "leader-0", { outcome: "error" }, asOf + 100);
  expect(withLibrary(db => acknowledgeAll(db, runtime, { asOf }))).toEqual({ ok: true, cleared: 4 });
  expect(summary().unread).toBe(1);
});

it("uses the latest inserted update when multiple lifecycle revisions share a timestamp", () => {
  overview();
  itemFixture(runtime, workspace, "leader", 100); primary("leader");
  for (let i = 0; i < 10; i++) changeItem(runtime, "leader", { runtime: "working" }, 200);
  expect(page().events[0]).toMatchObject({ revision: 10, at: 200 });
  const shown = page();
  withLibrary(db => acknowledgeEvents(db, runtime, workspace.id, { receipt: shown.receipt, events: shown.events }));
  changeItem(runtime, "leader", { runtime: "inactive", outcome: "completed" }, 200);
  expect(page().events).toEqual([expect.objectContaining({ revision: 11, unread: true })]);
  expect(overview().total).toBe(1);
});
