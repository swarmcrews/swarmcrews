import fs from "node:fs";
import { canonicalizeSourceRoot } from "../workspace-registry.ts";
import type Database from "better-sqlite3";
import type { ProjectActivitySummary } from "../../shared/project-activity.ts";
import type { LibraryAttentionItem, LibrarySummary } from "../../shared/project-library/index.ts";
import { LIBRARY_BATCH_SIZE } from "../../shared/project-library/index.ts";
import { authorizeWorkspace, registeredWorkspaces, assertRevision, bumpFocus, ensureEntry, LibraryError, projectFromRow } from "./store.ts";
import { eventSummary } from "./events.ts";
import { libraryRuntimeEvidence } from "./runtime.ts";
import { graphAuthorityExpressions } from "./graph-authority.ts";
import { ensureLibraryLifecycleEvents } from "./lifecycle-events.ts";
import { integrationAuthorityExpressions, unknownIntegrationProjects } from "./integration-authority.ts";

export type RuntimeReader = (ids: string[]) => ProjectActivitySummary[];
const decision = "(runtime_state='waiting' AND wait_kind='decision' AND resolution<>'archived')";
const review = "(resolution='open' AND outcome IN ('completed','error','stopped','interrupted'))";
const conflict = "(integration_state IN ('worktree_conflicted','live_conflict_wait') OR (runtime_state='waiting' AND wait_kind='file_conflict'))";
const active = "(runtime_state IN ('starting','working','waiting') OR integration_state IN ('worktree_queued','worktree_integrating'))";
const invalid = `(runtime_state NOT IN ('draft','starting','working','waiting','inactive')
  OR outcome NOT IN ('none','completed','error','stopped','interrupted')
  OR resolution NOT IN ('open','reviewed','archived')
  OR integration_state NOT IN ('live_clean','live_editing','live_conflict_wait','worktree_unprovisioned','worktree_active','worktree_queued','worktree_integrating','worktree_conflicted','worktree_integrated','worktree_discarded')
  OR (runtime_state<>'inactive' AND outcome<>'none') OR (resolution='reviewed' AND outcome='none')
  OR (resolution='archived' AND runtime_state NOT IN ('draft','inactive'))
  OR change_mode NOT IN ('live','worktree')
  OR (change_mode='live' AND integration_state NOT LIKE 'live_%')
  OR (change_mode='worktree' AND integration_state NOT LIKE 'worktree_%')
  OR (wait_kind IS NOT NULL AND wait_kind NOT IN ('decision','file_conflict','other')))`;
interface Aggregate { project_id: string; active: number; executing: number; attention: number; decision: number; review: number; conflict: number; invalid: number }
function attentionExpressions(db: Database.Database) {
  const graph = graphAuthorityExpressions(db); const integration = integrationAuthorityExpressions(db);
  return { decisions: `(${decision} OR ${graph.decision})`, reviews: `(${review} OR ${integration.review})`,
    conflicts: `(${conflict} OR ${integration.conflict})`,
    active: `(${active} OR ${graph.live} OR ${integration.live})`,
    executing: `(runtime_state IN ('starting','working') OR integration_state='worktree_integrating' OR ${integration.executing})`,
    invalid: `(${invalid} OR ${graph.unknown} OR ${integration.unknown})` };
}
function aggregate(db: Database.Database, ids: string[]): Map<string, Aggregate> {
  const e = attentionExpressions(db);
  const rows = db.prepare(`SELECT project_id, SUM(${e.active}) AS active, SUM(${e.executing}) AS executing,
    SUM(${e.decisions} OR ${e.reviews} OR ${e.conflicts}) AS attention,
    SUM(${e.decisions}) AS decision,SUM(${e.reviews}) AS review,SUM(${e.conflicts}) AS conflict,SUM(${e.invalid}) AS invalid
    FROM work_items WHERE project_id IN (${ids.map(() => "?").join(",")}) GROUP BY project_id`).all(...ids) as Aggregate[];
  return new Map(rows.map(row => [row.project_id, row]));
}
function unknownLegacy(db: Database.Database, ids: string[]): Set<string> {
  // Unmigrated sessions cannot be treated as "quiet". No transcript/task JSON reads.
  const rows = db.prepare(`SELECT DISTINCT s.project_id FROM sessions s LEFT JOIN work_items w ON s.work_item_id=w.id
    WHERE s.project_id IN (${ids.map(() => "?").join(",")}) AND (
      (s.work_item_id IS NULL AND (s.status NOT IN ('idle','stopped','error','completed')
        OR (s.review_state <> 'none' AND s.acknowledged_at IS NULL AND s.dismissed_at IS NULL)))
      OR (s.work_item_id IS NOT NULL AND s.ended_at IS NULL AND
        (w.id IS NULL OR (s.run_kind='child' AND w.runtime_state IN ('draft','inactive'))
          OR (s.session_key=w.current_run_key AND w.runtime_state IN ('draft','inactive')))))`).all(...ids) as Array<{ project_id: string }>;
  return new Set(rows.map(row => row.project_id));
}
export function summarizeLibrary(db: Database.Database, runtimeDb: Database.Database | null, runtimeReader: RuntimeReader | undefined,
  requested: string[]): LibrarySummary[] {
  return summarizeProjects(db, runtimeDb, runtimeReader, requested, true);
}
/** Runtime-only eligibility for explicit missing-folder cleanup. Callers must independently
 * prove the source is missing, and fence this check plus the organization write. Never expose
 * these internal summaries as ordinary fresh project status. */
export function missingSourceArchiveEligibility(db: Database.Database, runtimeDb: Database.Database | null,
  runtimeReader: RuntimeReader | undefined, ids: string[]): Map<string, boolean> {
  return new Map(summarizeProjects(db, runtimeDb, runtimeReader, ids, false).map(s => [s.projectId, s.archiveEligible]));
}
function summarizeProjects(db: Database.Database, runtimeDb: Database.Database | null, runtimeReader: RuntimeReader | undefined,
  requested: string[], requireSource: boolean): LibrarySummary[] {
  const ids = [...new Set(requested)];
  if (ids.length > LIBRARY_BATCH_SIZE) throw new LibraryError(400, "BATCH_TOO_LARGE", "Maximum 100 project IDs");
  const workspaces = registeredWorkspaces(ids);
  // A replaced source is a per-project recovery state, not a batch failure. Only
  // unchanged roots may reach runtime readers or source availability checks.
  const safeSources = new Set(workspaces.filter(w => canonicalizeSourceRoot(w.sourceRoot) === w.sourceRoot).map(w => w.id));
  const readableIds = ids.filter(id => safeSources.has(id));
  if (!ids.length) return [];
  const checkedAt = new Date().toISOString(); const expiresAt = new Date(Date.now() + 15000).toISOString();
  let aggregates = new Map<string, Aggregate>(); let unknown = new Set<string>();
  let counts = new Map<string, number>(); let recent = new Map<string, NonNullable<LibrarySummary["recent"]>>();
  let hosts = new Map<string, ProjectActivitySummary>(); let dataKnown = !!runtimeDb && !!runtimeReader;
  try {
    if (runtimeDb && readableIds.length) {
      ensureLibraryLifecycleEvents(runtimeDb);
      aggregates = aggregate(runtimeDb, readableIds); unknown = new Set([...unknownLegacy(runtimeDb, readableIds), ...unknownIntegrationProjects(runtimeDb, readableIds)]);
      ({ counts, recent } = eventSummary(db, runtimeDb, readableIds));
    }
    if (runtimeReader && readableIds.length) hosts = new Map(runtimeReader(readableIds).map(row => [row.projectId, row]));
  } catch { dataKnown = false; }
  return ids.map((projectId, index) => {
    const a = aggregates.get(projectId); const h = hosts.get(projectId); const evidence = libraryRuntimeEvidence(h);
    const fresh = safeSources.has(projectId) && dataKnown && evidence?.known === true && !unknown.has(projectId) && !a?.invalid
      && (!requireSource || fs.existsSync(workspaces[index]!.sourceRoot));
    const attention = fresh ? { total: a?.attention ?? 0, decision: a?.decision ?? 0, review: a?.review ?? 0, conflict: a?.conflict ?? 0 } : null;
    const running = evidence?.archiveBlocked === true || (a?.active ?? 0) + (h?.activeLeaders ?? 0) + (h?.activeCrew ?? 0) + (evidence?.activeOther ?? 0) > 0;
    // Unresolved work still blocks archive; only execution paints Running on cards.
    const executing = fresh ? (a?.executing ?? 0) + evidence!.runningLeaders + (h?.activeCrew ?? 0) + evidence!.runningOther > 0 : null;
    const unread = fresh ? counts.get(projectId) ?? 0 : null;
    return { projectId, freshness: fresh ? "fresh" : "unknown", checkedAt, expiresAt,
      state: !fresh ? "unknown" : attention!.total > 0 ? "attention" : running ? "running" : unread! > 0 ? "new" : "up_to_date",
      activeLeaders: fresh ? h!.activeLeaders : null, activeCrew: fresh ? h!.activeCrew : null,
      activeOther: fresh ? evidence!.activeOther : null, activeWorkItems: fresh ? a?.active ?? 0 : null,
      running: executing, runningLeaders: fresh ? evidence!.runningLeaders : null,
      attention, unread, recent: recent.get(projectId) ?? null,
      archiveEligible: fresh && !running && attention!.total === 0 };
  });
}
export function listAttention(db: Database.Database, projectId: string, cursor?: string, limit = 50) {
  authorizeWorkspace(projectId);
  // Stable ID pagination, at most 51 lightweight rows. Destinations use WorkItem IDs, not guessed runs.
  const e = attentionExpressions(db);
  const rows = db.prepare(`SELECT id,substr(title,1,200) AS title,lifecycle_revision,current_run_key,${e.decisions} AS decision,
    ${e.reviews} AS review,${e.conflicts} AS conflict FROM work_items
    WHERE project_id=? AND (${e.decisions} OR ${e.reviews} OR ${e.conflicts}) ${cursor ? "AND id>?" : ""} ORDER BY id LIMIT ?`)
    .all(projectId, ...(cursor ? [cursor] : []), limit + 1) as Array<{ id: string; title: string; lifecycle_revision: number; current_run_key: string | null; decision: number; review: number; conflict: number }>;
  const items: LibraryAttentionItem[] = rows.slice(0, limit).map(row => ({ workItemId: row.id, title: row.title,
    revision: row.lifecycle_revision, currentRunKey: row.current_run_key,
    categories: (["decision", "review", "conflict"] as const).filter(category => row[category]) }));
  return { items, nextCursor: rows.length > limit ? items.at(-1)!.workItemId : null };
}
export function archiveProject(db: Database.Database, runtimeDb: Database.Database | null, runtimeReader: RuntimeReader | undefined,
  id: string, expectedRevision: number) {
  if (!runtimeDb || !runtimeReader) throw new LibraryError(409, "ARCHIVE_UNSAFE", "Fresh authoritative state unavailable");
  // Fence concurrent durable runtime arrivals for the full synchronous check+organization write.
  // No await, cached summary, agent start/stop or review call is permitted here.
  return runtimeDb.transaction(() => db.transaction(() => {
    const row = ensureEntry(db, id); assertRevision(row.revision, expectedRevision);
    const summary = summarizeLibrary(db, runtimeDb, runtimeReader, [id])[0]!;
    if (!summary.archiveEligible) throw new LibraryError(409, "ARCHIVE_UNSAFE", "Active, unresolved or unknown work blocks archive");
    db.prepare("UPDATE library_projects SET archived=1,focus_order=NULL,revision=revision+1 WHERE id=?").run(id);
    if (row.focus_order !== null) bumpFocus(db);
    return projectFromRow(ensureEntry(db, id));
  }).immediate()).immediate();
}
export function restoreProject(db: Database.Database, id: string, expectedRevision: number) {
  return db.transaction(() => {
    const row = ensureEntry(db, id); assertRevision(row.revision, expectedRevision);
    db.prepare("UPDATE library_projects SET archived=0,focus_order=NULL,revision=revision+1 WHERE id=?").run(id);
    if (row.focus_order !== null) bumpFocus(db);
    return projectFromRow(ensureEntry(db, id));
  }).immediate();
}
