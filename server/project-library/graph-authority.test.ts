import fs from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { migrateTaskGraph } from "../task-graph/schema.ts";
import { libraryFixture, runtimeFixture, workspaceFixture, quietRuntime, leaderItemFixture, changeItem } from "./test-fixture.ts";
import { withLibrary } from "./store.ts";
import { summarizeLibrary, archiveProject, listAttention } from "./summary.ts";
import { ensureLibraryLifecycleEvents } from "./lifecycle-events.ts";
import { listEvents } from "./events.ts";
let fixture: ReturnType<typeof libraryFixture>; let db: ReturnType<typeof runtimeFixture>;
let workspace: ReturnType<typeof workspaceFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home);
  db = runtimeFixture(fixture.root); workspace = workspaceFixture(fixture.root); migrateTaskGraph(db);
  leaderItemFixture(db, workspace, "work"); changeItem(db, "work", { runtime: "inactive", outcome: "completed", resolution: "reviewed" }, 1);
  db.prepare("UPDATE work_items SET current_run_key='primary' WHERE id='work'").run();
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
function graph(status: string, key = "primary") {
  db.prepare("INSERT OR IGNORE INTO task_graph_definitions VALUES ('definition','work',?,1)").run(workspace.id);
  db.prepare("INSERT OR IGNORE INTO task_graph_revisions VALUES ('revision','definition','{}','hash',1)").run();
  db.prepare("INSERT INTO task_graph_runs VALUES ('graph','work',?,'revision','source',?,0,0,2,1,1)").run(key, status);
}
function plan(state: string, primary = "primary") {
  db.prepare(`INSERT INTO task_graph_plan_proposals(id,work_item_id,primary_run_key,proposal_revision,projection_revision,state,mode,request_id,request_hash,plan_json,node_ids_json,created_at,updated_at)
    VALUES ('plan','work',?,1,1,?,'confirm','request','hash','{}','{}',1,1)`).run(primary, state);
}
const summary = () => withLibrary(library => summarizeLibrary(library, db, quietRuntime, [workspace.id])[0]!);
it("blocks any current nonterminal graph, including blocked/quiescent with a reviewed inactive parent", () => {
  graph("quiescent"); expect(summary()).toMatchObject({ state: "running", activeWorkItems: 1, running: false, archiveEligible: false });
  expect(() => withLibrary(library => archiveProject(library, db, quietRuntime, workspace.id, 0))).toThrow("blocks archive");
  db.prepare("UPDATE task_graph_runs SET status='blocked',revision=revision+1,updated_at=2 WHERE id='graph'").run();
  expect(summary()).toMatchObject({ running: false, activeWorkItems: 1, archiveEligible: false });
  db.prepare("UPDATE task_graph_runs SET status='mystery',revision=revision+1,updated_at=3 WHERE id='graph'").run();
  expect(summary()).toMatchObject({ freshness: "unknown", state: "unknown" });
  db.prepare("UPDATE task_graph_runs SET status='completed',revision=revision+1,updated_at=4 WHERE id='graph'").run();
  expect(summary().archiveEligible).toBe(true);
});
it("counts current plan input/start decisions once by WorkItem and ignores unrelated old-primary history", () => {
  plan("needs_input"); expect(summary()).toMatchObject({ attention: { total: 1, decision: 1 }, state: "attention" });
  expect(listAttention(db, workspace.id).items).toEqual([expect.objectContaining({ workItemId: "work", categories: ["decision"] })]);
  db.prepare("UPDATE task_graph_plan_proposals SET state='ready',projection_revision=2 WHERE id='plan'").run();
  expect(summary().attention!.decision).toBe(1);
  db.prepare("UPDATE task_graph_plan_proposals SET state='completed',projection_revision=3 WHERE id='plan'").run();
  expect(summary().attention!.total).toBe(0);
  db.prepare("UPDATE task_graph_plan_proposals SET primary_run_key='historical',state='needs_input',projection_revision=4 WHERE id='plan'").run();
  expect(summary().archiveEligible).toBe(true);
});
it("tracks material graph/plan status changes but not unchanged revision churn or topology JSON", () => {
  ensureLibraryLifecycleEvents(db); graph("active"); plan("needs_input");
  const before = summary().unread;
  db.prepare("UPDATE task_graph_runs SET revision=revision+1 WHERE id='graph'").run();
  expect(summary().unread).toBe(before);
  db.prepare("UPDATE task_graph_runs SET status='completed',revision=revision+1,updated_at=10 WHERE id='graph'").run();
  expect(summary().unread).toBe(before); // One conversation despite multiple graph/plan transitions.
  const events = withLibrary(library => listEvents(library, db, workspace.id)).events;
  expect(events.some(e => e.text.includes("Graph completed"))).toBe(true);
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain("plan_json");
});

it.each(['starting', 'running', 'mystery'])('fails closed for current %s plan without run authority, including after restart', state => {
  plan(state);
  expect(summary()).toMatchObject({ freshness: 'unknown', archiveEligible: false });
  expect(() => withLibrary(library => archiveProject(library, db, quietRuntime, workspace.id, 0))).toThrow('blocks archive');
  db.prepare("UPDATE task_graph_plan_proposals SET graph_run_id='missing' WHERE id='plan'").run();
  expect(summary()).toMatchObject({ freshness: 'unknown', archiveEligible: false });
  db.prepare("UPDATE task_graph_plan_proposals SET primary_run_key='historical' WHERE id='plan'").run();
  expect(summary().archiveEligible).toBe(true);
});
it('validates current plan mode and exact run ownership instead of substituting another run', () => {
  plan('running'); graph('active', 'historical');
  db.prepare("UPDATE task_graph_plan_proposals SET graph_run_id='graph' WHERE id='plan'").run();
  expect(summary().freshness).toBe('unknown');
  db.prepare("UPDATE task_graph_runs SET primary_run_key='primary' WHERE id='graph'").run();
  expect(summary()).toMatchObject({ freshness: 'fresh', state: 'running', archiveEligible: false });
  db.prepare("UPDATE task_graph_plan_proposals SET mode='mystery' WHERE id='plan'").run();
  expect(summary().freshness).toBe('unknown');
  db.prepare("UPDATE task_graph_plan_proposals SET state='ready',mode='auto',graph_run_id=NULL WHERE id='plan'").run();
  db.prepare("UPDATE task_graph_runs SET status='completed' WHERE id='graph'").run();
  expect(summary().archiveEligible).toBe(false);
});
