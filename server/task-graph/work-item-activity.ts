import type { GraphSnapshot } from "../../shared/task-graph-contracts.ts";
import type { TaskGraphSnapshotView } from "../../shared/task-graph-view-contracts.ts";
import { getWorkItem } from "../work-item-repo.ts";
import { itemSnapshot } from "../work-item-snapshots.ts";
import { emitItemChanged } from "../work-item-service-events.ts";
import type { TaskGraphService } from "./service.ts";

export function hasActiveGraphExecution(view: TaskGraphSnapshotView): boolean {
  return ["running", "quiescent"].includes(view.status)
    || view.nodes.some(node => node.currentAttempt
      && ["queued", "running", "backoff"].includes(node.currentAttempt.state));
}

/** UI approval/retry can start Crew work while the Leader stays idle. */
export function reconcileGraphDecisionWait(service: TaskGraphService, graph: GraphSnapshot,
  view: TaskGraphSnapshotView, at: number): void {
  if (!hasActiveGraphExecution(view)) return;
  const { db, bus } = service.options;
  const item = getWorkItem(db, graph.run.workItemId);
  if (!item || item.current_run_key !== graph.run.primaryRunKey
    || item.runtime_state !== "waiting" || item.wait_kind !== "decision") return;
  const changed = db.prepare(`UPDATE work_items SET wait_kind='other',
    lifecycle_revision=lifecycle_revision+1,last_transition_at=?,updated_at=?
    WHERE id=? AND current_run_key=? AND lifecycle_revision=?
    AND runtime_state='waiting' AND wait_kind='decision'`)
    .run(at, at, item.id, graph.run.primaryRunKey, item.lifecycle_revision);
  if (changed.changes === 1) emitItemChanged(bus,
    { workItem: itemSnapshot(getWorkItem(db, item.id)!) }, "graph_execution_active", at);
}
