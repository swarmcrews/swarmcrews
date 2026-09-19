import type Database from "better-sqlite3";
import { TaskGraphConflictError } from "./errors.ts";

export interface ConnectedGraphSourceBinding {
  nodeId: string;
  workItemId: string;
  primaryRunKey: string;
}

/**
 * The persisted canvas edge and both active WorkItem canvas bindings are the
 * authority for connected graph access. Browser context metadata merely
 * selects which of these sources is included in a prompt.
 */
export function connectedGraphSourcesForRecipient(
  db: Database.Database,
  recipient: { workItemId: string; primaryRunKey: string },
): ConnectedGraphSourceBinding[] {
  return db.prepare(`
    SELECT DISTINCT source_binding.binding_id AS node_id,
      source.id AS work_item_id, source.current_run_key AS primary_run_key
    FROM work_items recipient
    JOIN work_item_bindings target_binding
      ON target_binding.work_item_id = recipient.id
      AND target_binding.surface = 'canvas' AND target_binding.detached_at IS NULL
    JOIN edges edge
      ON edge.project_id = recipient.project_id
      AND edge.target_node_id = target_binding.binding_id
      AND edge.protocol = 'context' AND edge.context_mode = 'full'
    JOIN work_item_bindings source_binding
      ON source_binding.binding_id = edge.source_node_id
      AND source_binding.surface = 'canvas' AND source_binding.detached_at IS NULL
    JOIN work_items source
      ON source.id = source_binding.work_item_id
      AND source.project_id = recipient.project_id
    WHERE recipient.id = ? AND recipient.current_run_key = ?
      AND source.current_run_key IS NOT NULL
  `).all(recipient.workItemId, recipient.primaryRunKey).map((row) => {
    const value = row as Record<string, unknown>;
    return { nodeId: String(value.node_id), workItemId: String(value.work_item_id),
      primaryRunKey: String(value.primary_run_key) };
  });
}

export function assertCurrentConnectedGraphSource(
  db: Database.Database,
  recipient: { workItemId: string; primaryRunKey: string },
  source: ConnectedGraphSourceBinding,
): void {
  const current = connectedGraphSourcesForRecipient(db, recipient).some((candidate) =>
    candidate.nodeId === source.nodeId && candidate.workItemId === source.workItemId
      && candidate.primaryRunKey === source.primaryRunKey);
  if (!current) throw new TaskGraphConflictError("connected graph source is no longer authorized");
}
