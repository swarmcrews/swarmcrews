import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initDb } from "../db.ts";
import { ensureWorkItemSchema } from "../work-item-schema.ts";
import { registerWorkspace } from "../workspace-registry.ts";
import { createWorkItem } from "../work-item-repo.ts";
import type { RuntimeReader } from "./summary.ts";
import { withLibraryRuntimeEvidence } from "./runtime.ts";

/** Real SQLite/filesystem fixture; callers isolate MINIONS_HOME to root/home. */
export function libraryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-library-"));
  const home = path.join(root, "home"); fs.mkdirSync(home);
  return { root, home };
}
export function runtimeFixture(root: string) {
  const db = initDb(path.join(root, "server.db")); ensureWorkItemSchema(db); return db;
}
export function workspaceFixture(root: string, name = "Repository") {
  const source = fs.mkdtempSync(path.join(root, "repo-"));
  fs.writeFileSync(path.join(source, "keep.txt"), "Preserve source");
  return registerWorkspace(source, { nickname: name })!;
}
export const quietRuntime: RuntimeReader = ids => ids.map(projectId => withLibraryRuntimeEvidence({ projectId, activeLeaders: 0,
  activeCrew: 0 }, 0));
export function itemFixture(db: ReturnType<typeof runtimeFixture>, workspace: ReturnType<typeof workspaceFixture>, id: string, at = 1) {
  return createWorkItem(db, { id, projectId: workspace.id, projectPath: workspace.sourceRoot,
    title: `Work ${id}`, changeMode: "live", at });
}
export function changeItem(db: ReturnType<typeof runtimeFixture>, id: string, patch: {
  runtime?: string; outcome?: string; resolution?: string; integration?: string; wait?: string | null;
}, at = Date.now()) {
  db.prepare(`UPDATE work_items SET runtime_state=COALESCE(?,runtime_state),outcome=COALESCE(?,outcome),
    resolution=COALESCE(?,resolution),integration_state=COALESCE(?,integration_state),wait_kind=?,
    lifecycle_revision=lifecycle_revision+1,updated_at=? WHERE id=?`)
    .run(patch.runtime ?? null, patch.outcome ?? null, patch.resolution ?? null, patch.integration ?? null,
      patch.wait ?? null, at, id);
}

/** A durable leader conversation, with a completed primary run (no live host needed). */
export function leaderItemFixture(db: ReturnType<typeof runtimeFixture>, workspace: ReturnType<typeof workspaceFixture>, id: string, at = 1) {
  const item = itemFixture(db, workspace, id, at);
  db.prepare(`INSERT INTO sessions(session_key,project_id,work_item_id,role,run_kind,run_number,ended_at,run_outcome)
    VALUES (?, ?, ?, 'leader', 'primary', 1, ?, 'completed')`).run(`leader-${id}`, workspace.id, id, at);
  return item;
}
