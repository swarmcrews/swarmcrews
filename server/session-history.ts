import type Database from "better-sqlite3";
import { appendEvent, purgeEventsForSession } from "./session-repo.ts";
import type { BufferedEvent } from "./session-host-config.ts";
import { HISTORY_INLINE_BYTES, HISTORY_PAGE_BYTES, HISTORY_EVENT_COUNT, type HistoryWindow } from "../shared/history.ts";
/** Delete conversation content and insert its reset marker in one durable transaction. */
export function clearHistory(db: Database.Database, sessionKey: string): void {
  db.transaction(() => {
    purgeEventsForSession(db, sessionKey);
    appendEvent(db, sessionKey, "session_cleared", { type: "session_cleared", sessionKey, timestamp: Date.now() });
  })();
}
export function historyUrl(key: string): string { return `/api/history/${encodeURIComponent(key)}`; }
export function eventPreview(key: string, id: number, bytes: number, timestamp = 0): BufferedEvent {
  const url = `${historyUrl(key)}/events/${id}`;
  return { type: "sdk_event", sessionKey: key, historyId: id, historyRef: { id, bytes, url }, timestamp,
    event: { kind: "text", role: "assistant", id: `history-${id}`,
      text: `Archived event (${bytes} bytes). [Download exact event JSON](${url})` } };
}
/** Metadata is bounded before any payload crosses SQLite's native boundary. */
export function readHistoryPage(db: Database.Database, key: string, before = Number.MAX_SAFE_INTEGER,
  limit = HISTORY_EVENT_COUNT, after?: number): { events: BufferedEvent[]; history: HistoryWindow } {
  if (after !== undefined) return readHistorySince(db, key, after);
  const high = db.prepare("SELECT max(id) id FROM event_log WHERE session_key = ?").get(key) as { id: number | null };
  const rows = db.prepare(`SELECT id, length(CAST(payload AS BLOB)) bytes FROM event_log
    WHERE session_key = ? AND id < ? ORDER BY id DESC LIMIT ?`).all(key, before,
    Math.max(1, Math.min(HISTORY_EVENT_COUNT, limit))) as { id: number; bytes: number }[];
  const events: BufferedEvent[] = [];
  let used = 4096;
  for (const row of rows) {
    const reserve = row.bytes > HISTORY_INLINE_BYTES ? 8192 : row.bytes + 128;
    if (used + reserve > HISTORY_PAGE_BYTES) break;
    let event: BufferedEvent;
    if (row.bytes > HISTORY_INLINE_BYTES) event = readHistoryPreview(db, key, row.id, row.bytes);
    else {
      const record = db.prepare("SELECT payload FROM event_log WHERE session_key = ? AND id = ?").get(key, row.id) as { payload: string };
      event = { ...JSON.parse(record.payload) as BufferedEvent, historyId: row.id };
    }
    events.unshift(event); used += Buffer.byteLength(JSON.stringify(event)) + 1;
  }
  const oldest = events[0]?.historyId as number | undefined;
  const more = oldest && db.prepare("SELECT 1 FROM event_log WHERE session_key = ? AND id < ? LIMIT 1").get(key, oldest);
  return { events, history: { before: more ? oldest! : null, highWater: high.id ?? 0, url: historyUrl(key) } };
}
/** Ascending, exclusive cursor. A page never acknowledges rows not actually delivered. */
export function readHistorySince(db: Database.Database, key: string, after: number): { events: BufferedEvent[]; history: HistoryWindow } {
  const high = db.prepare("SELECT max(id) id FROM event_log WHERE session_key = ?").get(key) as { id: number | null };
  // Global autoincrement IDs keep rising after a clear. Its durable marker
  // invalidates pre-clear cursors even after new messages exceed that cursor.
  const cleared = db.prepare("SELECT id FROM event_log WHERE session_key = ? AND event_type = 'session_cleared' ORDER BY id DESC LIMIT 1")
    .get(key) as { id: number } | undefined;
  if (after > (high.id ?? 0) || (cleared && after < cleared.id)) {
    const page = readHistoryPage(db, key);
    return { ...page, history: { ...page.history, reset: true, nextAfter: null } };
  }
  const rows = db.prepare(`SELECT id, length(CAST(payload AS BLOB)) bytes FROM event_log
    WHERE session_key = ? AND id > ? ORDER BY id ASC LIMIT ?`).all(key, after, HISTORY_EVENT_COUNT + 1) as { id: number; bytes: number }[];
  const events: BufferedEvent[] = [];
  let used = 4096;
  for (const row of rows.slice(0, HISTORY_EVENT_COUNT)) {
    if (used + Math.min(row.bytes + 128, 8192) > HISTORY_PAGE_BYTES) break;
    const event = row.bytes > HISTORY_INLINE_BYTES ? readHistoryPreview(db, key, row.id, row.bytes)
      : { ...JSON.parse((db.prepare("SELECT payload FROM event_log WHERE session_key = ? AND id = ?")
        .get(key, row.id) as { payload: string }).payload) as BufferedEvent, historyId: row.id };
    const size = Buffer.byteLength(JSON.stringify(event)) + 1;
    if (used + size > HISTORY_PAGE_BYTES) break;
    events.push(event);
    used += size;
  }
  const delivered = Number(events.at(-1)?.historyId ?? after);
  const highWater = high.id ?? 0;
  return { events, history: { before: null, highWater, url: historyUrl(key),
    nextAfter: delivered < highWater ? delivered : null } };
}
export function readHistoryPreview(db: Database.Database, key: string, id: number, bytes: number): BufferedEvent {
  const row = db.prepare(`SELECT event_type, json_extract(payload, '$.timestamp') timestamp,
    substr(json_extract(payload, '$.event.kind'), 1, 64) kind,
    substr(json_extract(payload, '$.event.role'), 1, 16) role,
    substr(json_extract(payload, '$.event.id'), 1, 256) event_id,
    substr(json_extract(payload, '$.event.callId'), 1, 256) call_id,
    substr(json_extract(payload, '$.event.parentId'), 1, 256) parent_id,
    substr(json_extract(payload, '$.event.name'), 1, 256) name,
    substr(json_extract(payload, '$.checkpointId'), 1, 256) checkpoint_id,
    substr(json_extract(payload, '$.trigger'), 1, 32) trigger,
    json_extract(payload, '$.event.isError') is_error,
    substr(COALESCE(json_extract(payload, '$.event.text'), json_extract(payload, '$.event.name'),
      json_extract(payload, '$.event.output'), json_extract(payload, '$.error'), ''), 1, 1024) excerpt
    FROM event_log WHERE session_key = ? AND id = ?`).get(key, id) as {
      event_type: string; timestamp: number; excerpt: string; kind: string; role: string;
      event_id: string | null; call_id: string | null; parent_id: string | null; name: string | null;
      checkpoint_id: string | null; trigger: string | null; is_error: number | null;
    };
  const preview = eventPreview(key, id, bytes, row.timestamp);
  const notice = `Archived event (${bytes} bytes). [Download exact event JSON](${historyUrl(key)}/events/${id})`;
  // Tool payloads must not become synthetic assistant prose, even in a preview.
  if (row.kind === "tool_result") preview.event = { kind: "tool_result", callId: row.call_id ?? `history-${id}`,
    output: notice, isError: row.is_error === 1 };
  else if (row.kind === "tool_call") preview.event = { kind: "tool_call", id: row.event_id ?? `history-${id}`,
    name: row.name ?? "Archived tool", input: { archive: notice }, ...(row.parent_id !== null ? { parentId: row.parent_id } : {}) };
  else if (row.kind === "thinking") preview.event = { kind: "thinking", text: notice };
  else if (row.kind === "text") preview.event = { kind: "text", role: row.role === "user" ? "user" : "assistant",
    id: row.event_id ?? `history-${id}`, text: `[Archive preview] ${notice}\n\n${row.excerpt}` };
  if (row.event_type === "session_compacted") return { ...preview, type: "session_compacted", event: undefined,
    checkpointId: row.checkpoint_id ?? undefined,
    trigger: row.trigger === "context_recovery" ? "context_recovery" : "proactive" };
  if (row.event_type === "session_error") return { ...preview, type: "session_error", event: undefined,
    error: `Archived error: ${row.excerpt}`, fullError: `Exact error: ${historyUrl(key)}/events/${id}` };
  return preview;
}
export interface HistoryFacts { lastActivityAt: number | null; lastResponseAt: number | null; lastSdkEventKind: string | null; lastEventType: string | null; hasAssistant: boolean }
export function readHistoryFacts(db: Database.Database, key: string): HistoryFacts {
  const last = db.prepare(`SELECT event_type, json_extract(payload, '$.timestamp') timestamp,
    CASE WHEN event_type = 'sdk_event' THEN json_extract(payload, '$.event.kind') END kind
    FROM event_log WHERE session_key = ? AND event_type != 'session_cleared' ORDER BY id DESC LIMIT 1`).get(key) as { timestamp: number; kind: string | null; event_type: string } | undefined;
  const response = db.prepare(`SELECT json_extract(payload, '$.timestamp') timestamp FROM event_log
    WHERE session_key = ? AND event_type = 'sdk_event' AND json_extract(payload, '$.event.kind') = 'text'
    AND json_extract(payload, '$.event.role') = 'assistant' ORDER BY id DESC LIMIT 1`).get(key) as { timestamp: number } | undefined;
  return { lastActivityAt: last?.timestamp ?? null, lastResponseAt: response?.timestamp ?? null,
    lastEventType: last?.event_type ?? null, lastSdkEventKind: last?.kind ?? null, hasAssistant: Boolean(response) };
}
/** Fixed-size binary slices preserve the exact UTF-8 JSON, even across multibyte boundaries. */
export function readEventChunk(db: Database.Database, key: string, id: number, offset: number): Buffer | null {
  const row = db.prepare(`SELECT substr(CAST(payload AS BLOB), ?, 65536) chunk FROM event_log
    WHERE session_key = ? AND id = ?`).get(offset + 1, key, id) as { chunk: Buffer } | undefined;
  return row?.chunk ?? null;
}
/** Legacy instructions remain complete in event_log; prompt excerpts retain first objective and latest corrections. */
export function readHistoricalDirectives(db: Database.Database, key: string): string[] {
  const select = `SELECT id, substr(json_extract(payload, '$.event.text'), 1, 4000) text FROM event_log
    WHERE session_key = ? AND event_type = 'sdk_event' AND json_extract(payload, '$.event.kind') = 'text'
    AND json_extract(payload, '$.event.role') = 'user'`;
  const first = db.prepare(`${select} ORDER BY id LIMIT 1`).get(key) as { id: number; text: string } | undefined;
  const tail = db.prepare(`${select} ORDER BY id DESC LIMIT 12`).all(key) as { id: number; text: string }[];
  return [...new Map([...(first ? [first] : []), ...tail.reverse()].map(r => [r.id, `${r.text}\n[Instruction excerpt; exact source: ${historyUrl(key)}/events/${r.id}]`])).values()];
}
