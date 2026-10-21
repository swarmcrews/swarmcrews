import type Database from "better-sqlite3";

export function integrationAuthorityExpressions(db: Database.Database) {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE name IN ('worktree_contributions','worktree_lineages')").all() as Array<{ name: string }>).map(row => row.name));
  if (!tables.has("worktree_contributions") || !tables.has("worktree_lineages"))
    return { live: "0", executing: "0", review: "0", conflict: "0", unknown: "integration_state='worktree_active'" };
  const exists = (condition: string) => `EXISTS(SELECT 1 FROM worktree_contributions c JOIN worktree_lineages l ON l.id=c.lineage_id
    WHERE c.work_item_id=work_items.id AND l.status='open' AND (${condition}))`;
  return {
    live: exists("c.state IN ('planned','provisioning','active','queued','integrating') OR l.integration_state IN ('queued','integrating')"),
    executing: exists("c.state IN ('provisioning','integrating') OR l.integration_state='integrating'"),
    review: exists("c.state IN ('ready','integrated') AND l.integration_state='active'"),
    conflict: exists("c.state IN ('conflicted','failed') OR l.integration_state='conflicted'"),
    unknown: exists("c.state NOT IN ('planned','provisioning','active','ready','queued','integrating','integrated','conflicted','failed','discarded') OR c.review_state NOT IN ('pending','approved','rejected')"),
  };
}
export function unknownIntegrationProjects(db: Database.Database, ids: string[]): string[] {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='worktree_lineages'").get()) return [];
  const rows = db.prepare(`SELECT DISTINCT l.project_id FROM worktree_lineages l
    WHERE (l.project_id IN (${ids.map(() => "?").join(",")}) OR l.project_id='') AND (
      l.status NOT IN ('open','integrated','abandoned') OR l.integration_state NOT IN ('active','queued','integrating','conflicted','integrated','abandoned') OR
      (l.status='open' AND (l.integration_state IN ('queued','integrating','conflicted') OR (l.integration_head_sha IS NOT NULL AND l.integration_head_sha<>l.base_sha))
      AND NOT EXISTS(SELECT 1 FROM worktree_contributions c JOIN work_items w ON w.id=c.work_item_id WHERE c.lineage_id=l.id)))`)
    .all(...ids) as Array<{ project_id: string }>;
  return rows.some(row => row.project_id === '') ? ids : rows.map(row => row.project_id);
}
export function ensureIntegrationLibraryEvents(db: Database.Database) {
  const objects = new Set((db.prepare("SELECT name FROM sqlite_master WHERE name IN ('worktree_contributions','library_contribution_changed')").all() as Array<{ name: string }>).map(row => row.name));
  if (!objects.has("worktree_contributions") || objects.has("library_contribution_changed")) return;
  db.exec(`CREATE INDEX IF NOT EXISTS library_contribution_scope ON worktree_contributions(work_item_id,state);
    CREATE TRIGGER library_contribution_changed AFTER UPDATE ON worktree_contributions
    WHEN OLD.state<>NEW.state OR OLD.review_state<>NEW.review_state BEGIN
      INSERT OR IGNORE INTO library_work_events
        SELECT 'contribution:'||NEW.id||':'||NEW.revision,project_id,id,NEW.revision,
          substr(title,1,200)||' · Contribution '||NEW.state||' · '||NEW.review_state,NEW.updated_at
        FROM work_items WHERE id=NEW.work_item_id;
    END;`);
}
