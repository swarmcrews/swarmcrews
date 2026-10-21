/** Read projection only: one latest material update per primary leader conversation.
 * WorkItem identity survives leader continuations. Child-only/standalone work is
 * not a leader conversation. Keep raw events for receipt/revision validation.
 * Equal timestamps use insertion order, not lexicographic revision IDs.
 * With a watermark, callers bind it twice before any outer-query parameters.
 */
export function leaderEventSource(watermark = false): string {
  return `(SELECT e.id,e.project_id,e.work_item_id,e.revision,e.text,e.at FROM library_work_events e
    WHERE ${watermark ? "e.at <= ? AND" : ""}
      EXISTS (SELECT 1 FROM sessions s WHERE s.work_item_id=e.work_item_id
        AND s.project_id=e.project_id AND s.role='leader' AND s.run_kind='primary')
      AND NOT EXISTS (SELECT 1 FROM library_work_events newer
        WHERE newer.project_id=e.project_id AND newer.work_item_id=e.work_item_id
          ${watermark ? "AND newer.at <= ?" : ""}
          AND (newer.at > e.at OR (newer.at=e.at AND newer.rowid > e.rowid))))`;
}
