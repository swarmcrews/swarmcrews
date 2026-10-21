import type Database from "better-sqlite3";

/** Lightweight authority only: never hydrate graph topology, plan JSON or history. */
export function graphAuthorityExpressions(db: Database.Database) {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('task_graph_runs','task_graph_plan_proposals')").all() as Array<{ name: string }>).map(row => row.name));
  const runs = tables.has("task_graph_runs"); const plans = tables.has("task_graph_plan_proposals");
  const currentPlan = `p.work_item_id=work_items.id AND p.primary_run_key=work_items.current_run_key
    AND NOT EXISTS(SELECT 1 FROM task_graph_plan_proposals newer WHERE newer.work_item_id=p.work_item_id
      AND newer.primary_run_key=p.primary_run_key AND newer.proposal_revision>p.proposal_revision)`;
  const runLive = runs ? `EXISTS(SELECT 1 FROM task_graph_runs g WHERE g.work_item_id=work_items.id
    AND g.primary_run_key=work_items.current_run_key AND g.status NOT IN ('completed','failed','cancelled'))` : "0";
  // A ready auto plan and a persisted start intention are work, even before a host exists.
  const planLive = plans ? `EXISTS(SELECT 1 FROM task_graph_plan_proposals p WHERE ${currentPlan}
    AND (p.state IN ('starting','running') OR (p.state='ready' AND p.mode='auto')))` : "0";
  const live = `(${runLive} OR ${planLive})`;
  const decision = plans ? `EXISTS(SELECT 1 FROM task_graph_plan_proposals p WHERE ${currentPlan}
    AND work_items.resolution<>'archived' AND (p.state='needs_input' OR (p.state='ready' AND p.mode='confirm')))` : "0";
  const runUnknown = runs ? `EXISTS(SELECT 1 FROM task_graph_runs g WHERE g.work_item_id=work_items.id
    AND g.primary_run_key=work_items.current_run_key
    AND g.status NOT IN ('active','quiescent','blocked','completed','failed','cancelled'))` : "0";
  const matchingRun = runs ? `EXISTS(SELECT 1 FROM task_graph_runs g WHERE g.id=p.graph_run_id
    AND g.work_item_id=p.work_item_id AND g.primary_run_key=p.primary_run_key
    AND g.status IN ('active','quiescent','blocked'))` : "0";
  // Recovery may defer a starting plan. Only its exact owned run can supply authority;
  // invalid state/mode and missing/incoherent execution linkage are never safe zeroes.
  const planUnknown = plans ? `EXISTS(SELECT 1 FROM task_graph_plan_proposals p WHERE ${currentPlan}
    AND (p.state NOT IN ('needs_input','ready','stale','starting','running','completed','failed','cancelled','rejected','superseded')
      OR p.mode NOT IN ('auto','confirm') OR (p.state IN ('starting','running') AND NOT ${matchingRun})))` : "0";
  const unknown = `(${runUnknown} OR ${planUnknown})`;
  return { live, decision, unknown };
}

export function ensureGraphLibraryEvents(db: Database.Database) {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE name IN ('task_graph_runs','task_graph_plan_proposals','library_graph_changed','library_plan_changed')").all() as Array<{ name: string }>).map(row => row.name));
  if (tables.has("task_graph_runs") && !tables.has("library_graph_changed")) db.exec(`
    CREATE TRIGGER IF NOT EXISTS library_graph_changed AFTER UPDATE ON task_graph_runs
    WHEN OLD.status<>NEW.status OR OLD.paused<>NEW.paused BEGIN
      INSERT OR IGNORE INTO library_work_events
        SELECT 'graph:'||NEW.id||':'||NEW.revision,project_id,id,NEW.revision,
          substr(title,1,200)||' · Graph '||NEW.status,NEW.updated_at
        FROM work_items WHERE id=NEW.work_item_id;
    END;
    CREATE TRIGGER IF NOT EXISTS library_graph_created AFTER INSERT ON task_graph_runs BEGIN
      INSERT OR IGNORE INTO library_work_events
        SELECT 'graph:'||NEW.id||':'||NEW.revision,project_id,id,NEW.revision,
          substr(title,1,200)||' · Graph '||NEW.status,NEW.updated_at
        FROM work_items WHERE id=NEW.work_item_id;
    END;
  `);
  if (tables.has("task_graph_plan_proposals") && !tables.has("library_plan_changed")) db.exec(`
    CREATE TRIGGER IF NOT EXISTS library_plan_changed AFTER UPDATE ON task_graph_plan_proposals
    WHEN OLD.state<>NEW.state BEGIN
      INSERT OR IGNORE INTO library_work_events
        SELECT 'plan:'||NEW.id||':'||NEW.projection_revision,project_id,id,NEW.projection_revision,
          substr(title,1,200)||' · Plan '||NEW.state,NEW.updated_at
        FROM work_items WHERE id=NEW.work_item_id;
    END;
    CREATE TRIGGER IF NOT EXISTS library_plan_created AFTER INSERT ON task_graph_plan_proposals BEGIN
      INSERT OR IGNORE INTO library_work_events
        SELECT 'plan:'||NEW.id||':'||NEW.projection_revision,project_id,id,NEW.projection_revision,
          substr(title,1,200)||' · Plan '||NEW.state,NEW.updated_at
        FROM work_items WHERE id=NEW.work_item_id;
    END;
  `);
}
