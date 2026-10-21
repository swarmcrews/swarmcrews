import type Database from "better-sqlite3";
import crypto from "node:crypto";
import { leaderEventSource } from "./leader-events.ts";
import { LibraryError, authorizeWorkspace } from "./store.ts";
import { ensureLibraryLifecycleEvents } from "./lifecycle-events.ts";
import type { LibraryEvent, LibraryEventPage } from "../../shared/project-library/index.ts";

interface EventRow { id: string; project_id: string; work_item_id?: string; revision: number; text: string; at: number; unread: number }
export function ensureAck(db: Database.Database) {
  db.exec("CREATE TABLE IF NOT EXISTS library_ack (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)");
}
function event(row: EventRow): LibraryEvent {
  const workItemId = row.work_item_id ?? null;
  return { id: row.id, revision: row.revision, projectId: row.project_id, workItemId,
    kind: workItemId ? "work_item" : "context", text: row.text, at: row.at, unread: !!row.unread,
    destination: workItemId ? { view: "activity", workItemId } : { view: "context" } };
}
function queryPage(db: Database.Database, table: "library_work_events" | "library_context_events", id: string,
  cursor: [number, string] | null, limit: number): LibraryEvent[] {
  return (db.prepare(`SELECT e.*, NOT EXISTS(SELECT 1 FROM library_ack a WHERE a.id=e.id AND a.revision=e.revision) AS unread
    FROM ${table === "library_work_events" ? leaderEventSource() : table} e WHERE project_id=? ${cursor ? "AND (at < ? OR (at = ? AND e.id < ?))" : ""}
    ORDER BY at DESC,e.id DESC LIMIT ?`).all(id, ...(cursor ? [cursor[0], cursor[0], cursor[1]] : []), limit) as EventRow[]).map(event);
}
function secret(db: Database.Database): string {
  db.prepare("INSERT OR IGNORE INTO library_meta VALUES ('receipt_secret',?)").run(crypto.randomBytes(32).toString("hex"));
  return (db.prepare("SELECT value FROM library_meta WHERE key='receipt_secret'").get() as { value: string }).value;
}
function sign(db: Database.Database, body: string) { return crypto.createHmac("sha256", secret(db)).update(body).digest("hex"); }
function receipt(db: Database.Database, projectId: string, events: LibraryEvent[]) {
  const body = Buffer.from(JSON.stringify({ projectId, expires: Date.now() + 3600000,
    events: events.map(({ id, revision }) => ({ id, revision })) })).toString("base64url");
  return `${body}.${sign(db, body)}`;
}
export function listEvents(db: Database.Database, runtime: Database.Database | null, id: string, cursorValue?: string, limit = 50): LibraryEventPage {
  authorizeWorkspace(id);
  if (!runtime) throw new LibraryError(503, "STATE_UNAVAILABLE", "Work history unavailable; retry before reading updates");
  ensureLibraryLifecycleEvents(runtime); ensureAck(runtime);
  let cursor: [number, string] | null = null;
  if (cursorValue) {
    try {
      const parsed = JSON.parse(Buffer.from(cursorValue, "base64url").toString()) as { projectId: string; at: number; id: string };
      if (parsed.projectId !== id || !Number.isSafeInteger(parsed.at) || typeof parsed.id !== "string") throw new Error();
      cursor = [parsed.at, parsed.id];
    } catch { throw new LibraryError(400, "INVALID_CURSOR", "Invalid project event cursor"); }
  }
  const rows = [...queryPage(db, "library_context_events", id, cursor, limit + 1),
    ...queryPage(runtime, "library_work_events", id, cursor, limit + 1)]
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const events = rows.slice(0, limit); const last = events.at(-1);
  return { events, receipt: receipt(db, id, events), nextCursor: rows.length > limit && last
    ? Buffer.from(JSON.stringify({ projectId: id, at: last.at, id: last.id })).toString("base64url") : null };
}
export function acknowledgeEvents(db: Database.Database, runtime: Database.Database | null, projectId: string,
  input: { receipt: string; events: Array<{ id: string; revision: number }> }) {
  authorizeWorkspace(projectId);
  if (!runtime) throw new LibraryError(503, "STATE_UNAVAILABLE", "Work history unavailable");
  const [body, signature] = input.receipt.split(".");
  if (!body || !signature || !/^[a-f0-9]{64}$/.test(signature)
    || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(db, body))))
    throw new LibraryError(400, "INVALID_RECEIPT", "Displayed event receipt required");
  let shown: { projectId: string; expires: number; events: Array<{ id: string; revision: number }> };
  try { shown = JSON.parse(Buffer.from(body, "base64url").toString()); }
  catch { throw new LibraryError(400, "INVALID_RECEIPT", "Invalid displayed event receipt"); }
  if (shown.projectId !== projectId || shown.expires < Date.now()
    || input.events.some(e => !shown.events.some(s => s.id === e.id && s.revision === e.revision)))
    throw new LibraryError(400, "INVALID_RECEIPT", "Only displayed event IDs/revisions may be acknowledged");
  ensureAck(runtime);
  // Only unread projection changes: never call review, approve, dismiss or integration.
  runtime.transaction(() => db.transaction(() => {
    for (const e of input.events) {
      const owner = runtime.prepare("SELECT id FROM library_work_events WHERE id=? AND project_id=? AND revision=?").get(e.id, projectId, e.revision) ? runtime : db;
      const table = owner === runtime ? "library_work_events" : "library_context_events";
      if (!owner.prepare(`SELECT id FROM ${table} WHERE id=? AND project_id=? AND revision=?`).get(e.id, projectId, e.revision))
        throw new LibraryError(409, "EVENT_CHANGED", "Displayed event no longer exists");
      owner.prepare("INSERT OR REPLACE INTO library_ack VALUES (?,?)").run(e.id, e.revision);
    }
  }).immediate()).immediate();
  return { ok: true };
}
export function eventSummary(db: Database.Database, runtime: Database.Database, ids: string[]) {
  ensureLibraryLifecycleEvents(runtime); ensureAck(runtime);
  const counts = new Map(ids.map(id => [id, 0])); const recent = new Map<string, LibraryEvent>();
  if (!ids.length) return { counts, recent };
  for (const [source, table] of [[db, "library_context_events"], [runtime, "library_work_events"]] as const) {
    const rows = source.prepare(`SELECT project_id,COUNT(*) AS count FROM ${table === "library_work_events" ? leaderEventSource() : table} e
      WHERE project_id IN (${ids.map(() => "?").join(",")})
      AND NOT EXISTS(SELECT 1 FROM library_ack a WHERE a.id=e.id AND a.revision=e.revision) GROUP BY project_id`)
      .all(...ids) as Array<{ project_id: string; count: number }>;
    for (const row of rows) counts.set(row.project_id, counts.get(row.project_id)! + row.count);
    // Index-bounded top-one queries. No transcript or full event history materialization.
    for (const id of ids) {
      const candidate = queryPage(source, table, id, null, 1)[0]; const previous = recent.get(id);
      if (candidate && (!previous || candidate.at > previous.at || (candidate.at === previous.at && candidate.id > previous.id))) recent.set(id, candidate);
    }
  }
  return { counts, recent };
}

/** Two prepared, indexed top-one lookups per project; no counts or history hydration. */
export function recentEvents(db: Database.Database, runtime: Database.Database, ids: string[]) {
  ensureLibraryLifecycleEvents(runtime); ensureAck(runtime);
  const recent = new Map<string, LibraryEvent>();
  for (const [source, table] of [[db, "library_context_events"], [runtime, "library_work_events"]] as const) {
    const query = source.prepare(`SELECT e.*, substr(e.text,1,280) AS text,
      NOT EXISTS(SELECT 1 FROM library_ack a WHERE a.id=e.id AND a.revision=e.revision) AS unread
      FROM ${table === "library_work_events" ? leaderEventSource() : table} e WHERE project_id=? ORDER BY at DESC,e.id DESC LIMIT 1`);
    for (const id of ids) {
      const row = query.get(id) as EventRow | undefined;
      if (!row) continue;
      const candidate = event(row), previous = recent.get(id);
      if (!previous || candidate.at > previous.at || (candidate.at === previous.at && candidate.id > previous.id)) recent.set(id, candidate);
    }
  }
  return recent;
}
