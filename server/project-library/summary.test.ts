import fs from "node:fs";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { libraryFixture, runtimeFixture, workspaceFixture, quietRuntime, leaderItemFixture, changeItem } from "./test-fixture.ts";
import { withLibrary, listLibrary, setFocus, patchMetadata, recordContextChanged } from "./store.ts";
import { archiveProject, restoreProject, summarizeLibrary, listAttention } from "./summary.ts";
import { acknowledgeEvents, listEvents } from "./events.ts";
import { ensureLibraryLifecycleEvents } from "./lifecycle-events.ts";
import { withLibraryRuntimeEvidence } from "./runtime.ts";

let fixture: ReturnType<typeof libraryFixture>; let runtime: ReturnType<typeof runtimeFixture>;
let workspace: ReturnType<typeof workspaceFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home);
  runtime = runtimeFixture(fixture.root); workspace = workspaceFixture(fixture.root); });
afterEach(() => { runtime.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
const summary = () => withLibrary(db => summarizeLibrary(db, runtime, quietRuntime, [workspace.id])[0]!);

describe("bounded authoritative project summaries", () => {
  it("keeps waiting/review work archive-unsafe without reporting it as executing", () => {
    leaderItemFixture(runtime, workspace, "waiting");
    changeItem(runtime, "waiting", { runtime: "waiting", wait: "decision" });
    expect(summary()).toMatchObject({ state: "attention", activeWorkItems: 1, running: false, runningLeaders: 0, archiveEligible: false });
    changeItem(runtime, "waiting", { runtime: "working" });
    expect(summary()).toMatchObject({ running: true, activeWorkItems: 1, archiveEligible: false });
    changeItem(runtime, "waiting", { runtime: "inactive", outcome: "completed" });
    expect(summary()).toMatchObject({ state: "attention", running: false, attention: { review: 1 }, archiveEligible: false });
  });

  it("distinguishes fresh quiet, new, active and deduplicated decision/review/conflict attention", () => {
    expect(summary()).toMatchObject({ freshness: "fresh", state: "up_to_date", unread: 0, archiveEligible: true });
    leaderItemFixture(runtime, workspace, "decision");
    expect(summary()).toMatchObject({ state: "new", unread: 1 });
    changeItem(runtime, "decision", { runtime: "working" });
    expect(summary()).toMatchObject({ state: "running", archiveEligible: false });
    changeItem(runtime, "decision", { runtime: "waiting", wait: "decision", integration: "live_conflict_wait" });
    leaderItemFixture(runtime, workspace, "review");
    changeItem(runtime, "review", { runtime: "inactive", outcome: "completed" });
    expect(summary()).toMatchObject({ state: "attention", attention: { total: 2, decision: 1, conflict: 1, review: 1 }, archiveEligible: false });
    const attention = listAttention(runtime, workspace.id);
    expect(attention.items).toEqual([expect.objectContaining({ workItemId: "decision", categories: ["decision", "conflict"] }),
      expect.objectContaining({ workItemId: "review", categories: ["review"] })]);
  });
  it("never labels missing/unknown/unmigrated authority up to date", () => {
    expect(withLibrary(db => summarizeLibrary(db, null, quietRuntime, [workspace.id])[0])).toMatchObject({ state: "unknown", unread: null });
    expect(withLibrary(db => summarizeLibrary(db, runtime, undefined, [workspace.id])[0])).toMatchObject({ state: "unknown", attention: null });
    expect(withLibrary(db => summarizeLibrary(db, runtime, ids => ids.map(projectId => ({ projectId, activeLeaders: 0, activeCrew: 0 })), [workspace.id])[0])).toMatchObject({ state: "unknown" });
    runtime.prepare("INSERT INTO sessions(session_key,project_id,status) VALUES ('legacy',?,'waiting')").run(workspace.id);
    expect(summary()).toMatchObject({ state: "unknown", archiveEligible: false });
    runtime.prepare("DELETE FROM sessions WHERE session_key='legacy'").run();
    fs.rmSync(workspace.sourceRoot, { recursive: true });
    expect(summary()).toMatchObject({ state: "unknown", archiveEligible: false });
  });
  it("fresh archive checks reject reraced runtime, unresolved review/conflict and invalid lifecycles", () => {
    expect(summary().archiveEligible).toBe(true);
    const activeNow = (ids: string[]) => quietRuntime(ids).map(h => withLibraryRuntimeEvidence(h, 1));
    expect(() => withLibrary(db => archiveProject(db, runtime, activeNow, workspace.id, 0))).toThrow("blocks archive");
    expect(withLibrary(listLibrary).projects[0]!.archived).toBe(false);
    leaderItemFixture(runtime, workspace, "work");
    changeItem(runtime, "work", { runtime: "inactive", outcome: "error" });
    expect(() => withLibrary(db => archiveProject(db, runtime, quietRuntime, workspace.id, 0))).toThrow("blocks archive");
    changeItem(runtime, "work", { resolution: "reviewed", integration: "live_conflict_wait" });
    expect(() => withLibrary(db => archiveProject(db, runtime, quietRuntime, workspace.id, 0))).toThrow("blocks archive");
    changeItem(runtime, "work", { integration: "live_clean", runtime: "broken" });
    expect(summary()).toMatchObject({ state: "unknown" });
    expect(() => withLibrary(db => archiveProject(db, runtime, quietRuntime, workspace.id, 0))).toThrow("blocks archive");
  });
  it("archives/restores organization only, preserving UUID, files, tags, collections and work history", () => {
    leaderItemFixture(runtime, workspace, "work"); changeItem(runtime, "work", { runtime: "inactive", outcome: "completed", resolution: "reviewed" });
    withLibrary(db => patchMetadata(db, workspace.id, { expectedRevision: 0, tags: ["keep"] }));
    withLibrary(db => setFocus(db, [workspace.id], 0));
    const before = runtime.prepare("SELECT * FROM work_items").all();
    const project = withLibrary(listLibrary).projects[0]!;
    const archived = withLibrary(db => archiveProject(db, runtime, quietRuntime, workspace.id, project.revision));
    expect(archived).toMatchObject({ id: workspace.id, archived: true, focusOrder: null, tags: ["keep"] });
    expect(() => withLibrary(db => setFocus(db, [workspace.id], 2))).toThrow("Restore project");
    const restored = withLibrary(db => restoreProject(db, workspace.id, archived.revision));
    expect(restored).toMatchObject({ archived: false, focusOrder: null, tags: ["keep"] });
    expect(runtime.prepare("SELECT * FROM work_items").all()).toEqual(before);
    expect(fs.readFileSync(path.join(workspace.sourceRoot, "keep.txt"), "utf8")).toBe("Preserve source");
  });
  it("acknowledges only displayed IDs/revisions, never review, while concurrent arrivals stay unread", () => {
    leaderItemFixture(runtime, workspace, "work");
    changeItem(runtime, "work", { runtime: "inactive", outcome: "completed" });
    recordContextChanged(workspace.id, "context");
    const page = withLibrary(db => listEvents(db, runtime, workspace.id));
    const before = runtime.prepare("SELECT * FROM work_items").get();
    changeItem(runtime, "work", { outcome: "error" });
    const displayed = page.events.map(({ id, revision }) => ({ id, revision }));
    withLibrary(db => acknowledgeEvents(db, runtime, workspace.id, { receipt: page.receipt, events: displayed }));
    expect(summary()).toMatchObject({ unread: 1, attention: { review: 1, total: 1 } });
    expect((runtime.prepare("SELECT resolution FROM work_items").get() as { resolution: string }).resolution).toBe("open");
    expect(before).toMatchObject({ resolution: "open" });
    const newcomer = withLibrary(db => listEvents(db, runtime, workspace.id)).events.find(e => e.unread)!;
    expect(() => withLibrary(db => acknowledgeEvents(db, runtime, workspace.id, { receipt: page.receipt,
      events: [{ id: newcomer.id, revision: newcomer.revision }] }))).toThrow("Only displayed");
    expect(() => withLibrary(db => acknowledgeEvents(db, runtime, workspace.id, { receipt: page.receipt,
      events: [{ ...displayed[0]!, revision: 999 }] }))).toThrow("Only displayed");
    const other = workspaceFixture(fixture.root);
    expect(() => withLibrary(db => acknowledgeEvents(db, runtime, other.id, { receipt: page.receipt, events: displayed }))).toThrow("Only displayed");
    expect(summary().unread).toBe(1);
    withLibrary(db => acknowledgeEvents(db, runtime, workspace.id, { receipt: page.receipt, events: displayed }));
    expect(summary().unread).toBe(1);
  });
  it("bounds event/attention pages and project batches, without selecting reports, transcripts or task JSON", () => {
    for (let i = 0; i < 120; i++) { leaderItemFixture(runtime, workspace, `w${String(i).padStart(3, "0")}`, i);
      changeItem(runtime, `w${String(i).padStart(3, "0")}`, { runtime: "inactive", outcome: "error" }, i); }
    runtime.prepare("UPDATE work_items SET title=?,lifecycle_revision=lifecycle_revision+1 WHERE id='w000'").run("x".repeat(100000));
    const statements: string[] = [];
    // Trace the SQLite boundary without mocking our modules.
    const original = runtime.prepare.bind(runtime);
    const spy = vi.spyOn(runtime, "prepare").mockImplementation(sql => { statements.push(sql); return original(sql); });
    expect(summary().attention!.total).toBe(120);
    const page = withLibrary(db => listEvents(db, runtime, workspace.id, undefined, 50));
    expect(page.events).toHaveLength(50); expect(page.nextCursor).not.toBeNull();
    const second = withLibrary(db => listEvents(db, runtime, workspace.id, page.nextCursor!, 50));
    expect(second.events).toHaveLength(50); expect(second.events.some(e => page.events.some(p => p.id === e.id))).toBe(false);
    const attention = listAttention(runtime, workspace.id, undefined, 50);
    expect(attention.items).toHaveLength(50);
    expect(attention.items.every(item => item.title.length <= 200)).toBe(true);
    expect(statements.filter(sql => sql.includes("SELECT e.*")).every(sql => sql.includes("LIMIT ?"))).toBe(true);
    expect(statements.join("\n")).not.toMatch(/session_events|final_report|task_state_json|nodes|render/);
    spy.mockRestore();
    expect(() => withLibrary(db => summarizeLibrary(db, runtime, quietRuntime, Array.from({ length: 101 }, (_, i) => `p${i}`)))).toThrow("Maximum 100");
  });
  it("rolls event projection back with failed lifecycle mutations and reinstalls after schema rollback", () => {
    expect(() => runtime.transaction(() => { ensureLibraryLifecycleEvents(runtime); throw new Error("rollback"); })()).toThrow("rollback");
    leaderItemFixture(runtime, workspace, "work");
    const count = summary().unread;
    expect(() => runtime.transaction(() => { changeItem(runtime, "work", { runtime: "working" }); throw new Error("rollback"); })()).toThrow("rollback");
    expect(summary().unread).toBe(count);
    expect((runtime.prepare("SELECT runtime_state FROM work_items").get() as { runtime_state: string }).runtime_state).toBe("draft");
  });
});

it("holds the runtime SQLite write fence through the archive check and preserves prior displayed-state staleness", () => {
  const other = runtimeFixture(fixture.root);
  other.pragma("busy_timeout = 0");
  leaderItemFixture(runtime, workspace, "quiet");
  const writerDuringCheck = (ids: string[]) => {
    expect(() => other.prepare("UPDATE work_items SET runtime_state='working' WHERE id='quiet'").run()).toThrow(/locked/);
    return quietRuntime(ids);
  };
  expect(withLibrary(db => archiveProject(db, runtime, writerDuringCheck, workspace.id, 0)).archived).toBe(true);
  other.close();
});

it("keeps planned/blocked roster work archive-unsafe without discarding known execution", () => {
  const waiting = (ids: string[]) => ids.map(projectId => withLibraryRuntimeEvidence({ projectId, activeLeaders: 0, activeCrew: 0 }, 0, true, { leaders: 0, other: 0 }, true));
  expect(withLibrary(db => summarizeLibrary(db, runtime, waiting, [workspace.id])[0])).toMatchObject({ freshness: "fresh", running: false, archiveEligible: false });
  expect(() => withLibrary(db => archiveProject(db, runtime, waiting, workspace.id, 0))).toThrow("blocks archive");
  const executing = (ids: string[]) => ids.map(projectId => withLibraryRuntimeEvidence({ projectId, activeLeaders: 1, activeCrew: 2 }, 0, true, { leaders: 1, other: 0 }, true));
  expect(withLibrary(db => summarizeLibrary(db, runtime, executing, [workspace.id])[0])).toMatchObject({ freshness: "fresh", running: true, runningLeaders: 1, activeCrew: 2, archiveEligible: false });
});

it.each(["symlink", "file"])("isolates %s-replaced roots as unknown without probing their replacement or suppressing valid siblings", replacement => {
  const sibling = workspaceFixture(fixture.root, "Valid sibling");
  fs.renameSync(workspace.sourceRoot, workspace.sourceRoot + "-old");
  if (replacement === "symlink") fs.symlinkSync(sibling.sourceRoot, workspace.sourceRoot, "dir");
  else fs.writeFileSync(workspace.sourceRoot, "Not the registered directory");
  const exists = vi.spyOn(fs, "existsSync");
  const reader = vi.fn(quietRuntime);
  try {
    const rows = withLibrary(db => summarizeLibrary(db, runtime, reader, [workspace.id, sibling.id]));
    expect(rows).toEqual([
      expect.objectContaining({ projectId: workspace.id, freshness: "unknown", state: "unknown", archiveEligible: false, attention: null, unread: null }),
      expect.objectContaining({ projectId: sibling.id, freshness: "fresh", state: "up_to_date", archiveEligible: true }),
    ]);
    // The identity check resolves the symlink once; no subsequent availability
    // probe or runtime-reader call may use that changed source.
    expect(exists.mock.calls.filter(([file]) => file === workspace.sourceRoot)).toHaveLength(1);
    expect(reader).toHaveBeenCalledWith([sibling.id]);
    reader.mockClear();
    expect(() => withLibrary(db => summarizeLibrary(db, runtime, reader, [workspace.id, sibling.id, "11111111-1111-4111-8111-111111111111"]))).toThrow("Registered workspace UUID required");
    expect(reader).not.toHaveBeenCalled();
  } finally { exists.mockRestore(); }
});
