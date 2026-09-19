import type Database from "better-sqlite3";

/** Query only archive membership, never work-item reports, runs, or history. */
export function withoutArchivedWork<T extends { workItemId?: string | null }>(
  entries: Array<[string, T]>, db: Database.Database | null,
): Array<[string, T]> {
  if (!db || entries.length === 0) return entries;
  const ids = [...new Set(entries.flatMap(([, host]) => host.workItemId ? [host.workItemId] : []))];
  const archived = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const rows = db.prepare(`SELECT id FROM work_items
      WHERE id IN (${batch.map(() => "?").join(",")}) AND resolution = 'archived'`)
      .all(...batch) as Array<{ id: string }>;
    for (const row of rows) archived.add(row.id);
  }
  return entries.filter(([, host]) => !host.workItemId || !archived.has(host.workItemId));
}
