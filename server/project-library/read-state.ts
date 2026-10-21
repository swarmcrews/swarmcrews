import type Database from "better-sqlite3";
import { LIBRARY_BATCH_SIZE, type LibraryUnread } from "../../shared/project-library/index.ts";
import { listWorkspaces } from "../workspace-registry.ts";
import { LibraryError, authorizeWorkspaces } from "./store.ts";
import { leaderEventSource } from "./leader-events.ts";
import { ensureAck } from "./events.ts";
import { ensureLibraryLifecycleEvents } from "./lifecycle-events.ts";

type Sources = ReadonlyArray<readonly [Database.Database, "library_context_events" | "library_work_events"]>;
function sources(db: Database.Database, runtime: Database.Database | null): Sources {
  if (!runtime) throw new LibraryError(503, "STATE_UNAVAILABLE", "Work history unavailable");
  ensureLibraryLifecycleEvents(runtime); ensureAck(runtime);
  return [[db, "library_context_events"], [runtime, "library_work_events"]];
}
function chunks<T>(items: T[]) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += LIBRARY_BATCH_SIZE) result.push(items.slice(i, i + LIBRARY_BATCH_SIZE));
  return result;
}
const unread = "NOT EXISTS(SELECT 1 FROM library_ack a WHERE a.id=e.id AND a.revision=e.revision)";

/** Library-wide unread total, stamped with the instant counted so a later clear cannot reach newer arrivals. */
export function unreadOverview(db: Database.Database, runtime: Database.Database | null): LibraryUnread {
  const owners = sources(db, runtime); const asOf = Date.now(); const byProject = new Map<string, number>();
  for (const ids of chunks(listWorkspaces().map(workspace => workspace.id))) {
    for (const [source, table] of owners) {
      const rows = source.prepare(`SELECT e.project_id, COUNT(*) AS count FROM ${table === "library_work_events" ? leaderEventSource(true) : table} e
        WHERE e.project_id IN (${ids.map(() => "?").join(",")}) AND e.at <= ? AND ${unread} GROUP BY e.project_id`)
        .all(...(table === "library_work_events" ? [asOf, asOf] : []), ...ids, asOf) as Array<{ project_id: string; count: number }>;
      for (const row of rows) byProject.set(row.project_id, (byProject.get(row.project_id) ?? 0) + row.count);
    }
  }
  return { total: [...byProject.values()].reduce((sum, count) => sum + count, 0), projects: byProject.size, asOf };
}

/**
 * Marks events read for the given projects (all registered projects when omitted). Only the unread
 * projection changes: reviews, decisions, conflicts and integration are never touched. Read state is
 * not a source write, so a project with a moved source root is still cleared.
 */
export function acknowledgeAll(db: Database.Database, runtime: Database.Database | null,
  input: { asOf: number; projectIds?: string[] | undefined }) {
  const owners = sources(db, runtime);
  const ids = input.projectIds ? authorizeWorkspaces(input.projectIds).map(workspace => workspace.id) : listWorkspaces().map(workspace => workspace.id);
  const asOf = Math.min(input.asOf, Date.now()); let cleared = 0;
  runtime!.transaction(() => db.transaction(() => {
    for (const batch of chunks(ids)) {
      for (const [source, table] of owners) {
        // Count the displayed unit (leader conversations/context changes), not
        // the raw lifecycle rows acknowledged underneath it.
        const visible = source.prepare(`SELECT COUNT(*) AS count FROM ${table === "library_work_events" ? leaderEventSource(true) : table} e
          WHERE e.project_id IN (${batch.map(() => "?").join(",")}) AND e.at <= ? AND ${unread}`)
          .get(...(table === "library_work_events" ? [asOf, asOf] : []), ...batch, asOf) as { count: number };
        cleared += visible.count;
        source.prepare(`INSERT OR REPLACE INTO library_ack(id, revision) SELECT e.id, e.revision FROM ${table} e
          WHERE e.project_id IN (${batch.map(() => "?").join(",")}) AND e.at <= ? AND ${unread}`).run(...batch, asOf).changes;
      }
    }
  }).immediate()).immediate();
  return { ok: true as const, cleared };
}
