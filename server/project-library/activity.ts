import type Database from "better-sqlite3";
import { LIBRARY_BATCH_SIZE, type LibraryLeaderPreview, type LibraryActivity } from "../../shared/project-library/index.ts";
import { listWorkspaces } from "../workspace-registry.ts";
import { LibraryError } from "./store.ts";
import { recentEvents } from "./events.ts";

/** Historical metadata for sorting/highlights, independent of live runtime summaries.
 * Missing sources remain discoverable, just as in listLibrary. No source files are read. */
export function recentLibraryActivity(db: Database.Database, runtime: Database.Database | null, requested: string[]): LibraryActivity[] {
  const ids = [...new Set(requested)];
  if (ids.length > LIBRARY_BATCH_SIZE) throw new LibraryError(400, "BATCH_TOO_LARGE", "Maximum 100 project IDs");
  const registered = new Set(listWorkspaces().map(workspace => workspace.id));
  if (ids.some(id => !registered.has(id))) throw new LibraryError(403, "NOT_REGISTERED", "Registered workspace UUID required");
  if (!runtime) throw new LibraryError(503, "STATE_UNAVAILABLE", "Project activity history unavailable");
  if (!ids.length) return [];
  const recent = recentEvents(db, runtime, ids);
  // WorkItem identity is the navigation authority. Continuations of one leader
  // stay one row; no child sessions, archived work, transcripts or task JSON.
  runtime.exec(`CREATE INDEX IF NOT EXISTS library_primary_leaders ON sessions(work_item_id) WHERE role='leader' AND run_kind='primary';
    CREATE INDEX IF NOT EXISTS library_recent_leader_work ON work_items(project_id, updated_at DESC, id DESC) WHERE resolution<>'archived'`);
  const leaders = runtime.prepare(`SELECT w.id AS workItemId, substr(w.title,1,200) AS title, w.updated_at AS at
    FROM work_items w WHERE w.project_id=? AND w.resolution<>'archived'
      AND EXISTS (SELECT 1 FROM sessions s WHERE s.work_item_id=w.id AND s.role='leader' AND s.run_kind='primary')
    ORDER BY w.updated_at DESC, w.id DESC LIMIT 3`);
  const checkedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 30000).toISOString();
  return ids.map(projectId => ({ projectId, recent: recent.get(projectId) ?? null, leaders: leaders.all(projectId) as LibraryLeaderPreview[], checkedAt, expiresAt }));
}
