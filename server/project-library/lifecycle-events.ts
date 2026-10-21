import type Database from "better-sqlite3";
import { ensureGraphLibraryEvents } from "./graph-authority.ts";
import { ensureIntegrationLibraryEvents } from "./integration-authority.ts";

const installed = new WeakSet<Database.Database>();
/** Transactional SQL projection: direct runtime/integration writes are covered too.
 * Only material lifecycle/title changes emit; tokens, tools and heartbeats do not.
 * Existing history imports one current-state baseline, not fabricated past transitions.
 */
export function ensureLibraryLifecycleEvents(db: Database.Database): void {
  if (installed.has(db) && db.prepare("SELECT name FROM sqlite_master WHERE name='library_work_changed'").get()) {
    ensureGraphLibraryEvents(db); ensureIntegrationLibraryEvents(db); return;
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS library_sessions_scope ON sessions(project_id,work_item_id,ended_at);
    CREATE INDEX IF NOT EXISTS library_update_leaders ON sessions(work_item_id,project_id) WHERE role='leader' AND run_kind='primary';
    CREATE TABLE IF NOT EXISTS library_work_events (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, work_item_id TEXT NOT NULL,
      revision INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS library_work_recent ON library_work_events(project_id, at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS library_work_conversation ON library_work_events(project_id,work_item_id,at DESC,id DESC);
    INSERT OR IGNORE INTO library_work_events
      SELECT 'work:'||id||':'||lifecycle_revision, project_id, id, lifecycle_revision,
        substr(title,1,200)||' · '||runtime_state||' · '||
        CASE WHEN outcome='none' THEN integration_state ELSE outcome||' · '||resolution END,
        updated_at FROM work_items;
    CREATE TRIGGER IF NOT EXISTS library_work_created AFTER INSERT ON work_items BEGIN
      INSERT OR IGNORE INTO library_work_events VALUES (
        'work:'||NEW.id||':'||NEW.lifecycle_revision,NEW.project_id,NEW.id,NEW.lifecycle_revision,
        substr(NEW.title,1,200)||' · '||NEW.runtime_state, NEW.updated_at);
    END;
    CREATE TRIGGER IF NOT EXISTS library_work_changed AFTER UPDATE ON work_items
    WHEN OLD.lifecycle_revision <> NEW.lifecycle_revision OR OLD.title <> NEW.title BEGIN
      INSERT OR IGNORE INTO library_work_events VALUES (
        'work:'||NEW.id||':'||NEW.lifecycle_revision||CASE WHEN OLD.lifecycle_revision=NEW.lifecycle_revision THEN ':'||hex(randomblob(8)) ELSE '' END,NEW.project_id,NEW.id,NEW.lifecycle_revision,
        substr(NEW.title,1,200)||' · '||NEW.runtime_state||' · '||
        CASE WHEN NEW.outcome='none' THEN NEW.integration_state ELSE NEW.outcome||' · '||NEW.resolution END,
        NEW.updated_at);
    END;
  `);
  ensureGraphLibraryEvents(db); ensureIntegrationLibraryEvents(db);
  installed.add(db);
}
