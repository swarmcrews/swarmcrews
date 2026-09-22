import type { WorkItemRunSnapshot } from "../shared/work-item-contracts.ts";
import type { TaskGraphNodeView } from "../shared/task-graph-view-contracts.ts";

export interface RunTaskContext {
  graphNodes?: readonly (Pick<TaskGraphNodeView, "id" | "title">
    & Partial<Pick<TaskGraphNodeView, "objective" | "currentAttempt" | "attemptHistory">>)[] | undefined;
  taskPlan?: readonly { taskId: string; title: string; description?: string }[] | undefined;
  onInspectNode?: ((nodeId: string) => void) | undefined;
}

/** Use existing metadata only; never borrow a later retry's executor details. */
export function childRunContext(run: WorkItemRunSnapshot, context: RunTaskContext) {
  const node = context.graphNodes?.find((node) => node.id === run.taskId);
  const task = context.taskPlan?.find((task) => task.taskId === run.taskId);
  const attempts = [...(node?.attemptHistory ?? []), ...(node?.currentAttempt ? [node.currentAttempt] : [])];
  const attempt = run.attemptId ? attempts.find((attempt) => attempt.id === run.attemptId) : undefined;
  const title = node?.title ?? task?.title;
  const label = `Child run${title ? ` · ${title}` : ""}`;
  const objective = (node?.objective ?? task?.description)?.replace(/\s+/g, " ").trim();
  const attemptNumber = run.attemptNumber ?? attempt?.number;
  const details = [attemptNumber ? `Attempt ${attemptNumber}` : null, attempt?.harness, attempt?.model]
    .filter(Boolean).join(" · ");
  return { label, content: `${label} · ${run.outcome === "none" ? "Active now" : run.outcome}`,
    objective, details, inspectNodeId: node?.id };
}
