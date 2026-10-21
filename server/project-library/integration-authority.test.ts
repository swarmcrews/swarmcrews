import fs from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { libraryFixture, runtimeFixture, workspaceFixture, quietRuntime, leaderItemFixture, changeItem } from "./test-fixture.ts";
import { ensureWorktreeIntegrationSchema } from "../worktree-integration-schema.ts";
import { ensureLibraryLifecycleEvents } from "./lifecycle-events.ts";
import { withLibrary } from "./store.ts";
import { summarizeLibrary, archiveProject, listAttention } from "./summary.ts";
import { listEvents, acknowledgeEvents } from "./events.ts";
let fixture: ReturnType<typeof libraryFixture>; let db: ReturnType<typeof runtimeFixture>; let workspace: ReturnType<typeof workspaceFixture>;
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home);
  db = runtimeFixture(fixture.root); workspace = workspaceFixture(fixture.root); ensureWorktreeIntegrationSchema(db);
  leaderItemFixture(db, workspace, "work"); changeItem(db, "work", { runtime: "inactive", outcome: "completed", resolution: "reviewed" }, 1);
  db.prepare("UPDATE work_items SET change_mode='worktree',integration_state='worktree_active' WHERE id='work'").run();
  db.prepare(`INSERT INTO worktree_lineages(id,project_id,repository_path,target_ref,base_sha,integration_ref,integration_worktree_path,created_at,updated_at)
    VALUES ('lineage',?,?,'main','base','integration','/central/worktree',1,1)`).run(workspace.id, workspace.sourceRoot);
  db.prepare(`INSERT INTO worktree_contributions(id,lineage_id,work_item_id,originating_run_key,branch_name,worktree_path,base_sha,head_sha,state,created_at,updated_at)
    VALUES ('contribution','lineage','work','run','branch','/central/contribution','base','head','ready',1,1)`).run();
  ensureLibraryLifecycleEvents(db);
});
afterEach(() => { db.close(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
const summary = () => withLibrary(library => summarizeLibrary(library, db, quietRuntime, [workspace.id])[0]!);
it("keeps work review separate from contribution/final approval, and blocks archive after reading updates", () => {
  expect(summary()).toMatchObject({ state: "attention", attention: { total: 1, review: 1 }, archiveEligible: false });
  expect(listAttention(db, workspace.id).items[0]).toMatchObject({ workItemId: "work", categories: ["review"] });
  const page = withLibrary(library => listEvents(library, db, workspace.id));
  withLibrary(library => acknowledgeEvents(library, db, workspace.id, { receipt: page.receipt, events: page.events.map(({ id, revision }) => ({ id, revision })) }));
  expect(db.prepare("SELECT review_state FROM worktree_contributions").get()).toEqual({ review_state: "pending" });
  expect(() => withLibrary(library => archiveProject(library, db, quietRuntime, workspace.id, 0))).toThrow("blocks archive");
  db.prepare("UPDATE worktree_contributions SET review_state='approved',revision=revision+1,updated_at=2").run();
  expect(summary().attention!.review).toBe(1);
  db.prepare("UPDATE worktree_contributions SET state='integrated',revision=revision+1,updated_at=3").run();
  expect(summary().attention!.review).toBe(1); // final lineage promotion remains separate
  db.prepare("UPDATE worktree_lineages SET status='integrated',integration_state='integrated',revision=revision+1").run();
  expect(summary().archiveEligible).toBe(true);
});
it("projects authoritative queued/conflicted integration states independently of inactive WorkItem runtime", () => {
  db.prepare("UPDATE worktree_contributions SET state='queued',revision=revision+1,updated_at=2").run();
  expect(summary()).toMatchObject({ state: "running", activeWorkItems: 1, running: false, archiveEligible: false });
  db.prepare("UPDATE worktree_contributions SET state='integrating',revision=revision+1,updated_at=3").run();
  expect(summary()).toMatchObject({ running: true, archiveEligible: false });
  db.prepare("UPDATE worktree_contributions SET state='conflicted',revision=revision+1,updated_at=3").run();
  expect(summary()).toMatchObject({ state: "attention", running: false, attention: { total: 1, conflict: 1 } });
  expect(withLibrary(library => listEvents(library, db, workspace.id)).events.some(event => event.text.includes("Contribution conflicted"))).toBe(true);
});
it("marks unattributable pending lineage integration unknown instead of fabricating a WorkItem count", () => {
  db.prepare("DELETE FROM worktree_contributions").run();
  db.prepare("UPDATE worktree_lineages SET integration_state='conflicted',revision=revision+1").run();
  expect(summary()).toMatchObject({ state: "unknown", attention: null, archiveEligible: false });
});
