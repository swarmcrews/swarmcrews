import { MAX_APPROVAL_CHILDREN, type ApprovalChild } from "../shared/session-crew.ts";
import { persistenceDb } from "./session-persist.ts";

/** Canonical, bounded current-primary child-attempt projection for approvals.
 * Never infer membership from host/browser metadata or scan the global registry.
 * Open children from superseded attempts/primaries cannot be resurrected here.
 */
export function sessionApprovalChildren(parentRunKey: string, db = persistenceDb()): ApprovalChild[] {
  if (!db) return [];
  const graphSchema = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_node_attempts'").get();
  return db.prepare(`SELECT c.session_key AS sessionKey, c.task_id AS taskId,
      c.attempt_id AS attemptId, c.attempt_number AS attemptNumber,
      substr(${graphSchema ? `COALESCE((SELECT json_extract(n.spec_json, '$.title')
        FROM task_node_attempts a JOIN task_graph_runs g ON g.id=a.run_id
        JOIN task_graph_nodes n ON n.revision_id=g.revision_id AND n.id=a.node_id
        WHERE a.id=c.attempt_id AND g.work_item_id=c.work_item_id
          AND g.primary_run_key=c.parent_run_key), c.task_name, c.task_id)` : "COALESCE(c.task_name,c.task_id)"},1,256) AS title
    FROM sessions c
    JOIN sessions p ON p.session_key=c.parent_run_key AND p.work_item_id=c.work_item_id
    JOIN work_items w ON w.id=p.work_item_id AND w.current_run_key=p.session_key
    WHERE p.session_key=? AND p.run_kind='primary'
      AND w.resolution<>'archived' AND c.run_kind='child' AND c.ended_at IS NULL
      AND c.attempt_id IS NOT NULL AND c.attempt_number>=1
      AND NOT EXISTS (SELECT 1 FROM sessions newer WHERE newer.work_item_id=c.work_item_id
        AND newer.parent_run_key=c.parent_run_key AND newer.task_id=c.task_id
        AND newer.run_kind='child' AND newer.attempt_number>c.attempt_number)
      ${graphSchema ? `AND NOT EXISTS (SELECT 1 FROM task_node_attempts a
        WHERE a.id=c.attempt_id AND (a.runtime='terminal' OR a.run_id IN
          (SELECT id FROM task_graph_runs WHERE work_item_id<>c.work_item_id
            OR primary_run_key<>c.parent_run_key)))` : ""}
    ORDER BY c.started_at DESC,c.session_key LIMIT ?`).all(parentRunKey, MAX_APPROVAL_CHILDREN) as ApprovalChild[];
}
