import type { TaskGraphNodeView } from "./types.ts";

/** Shared semantic appearance for both graph visualizations. */
export function graphSignal(node: TaskGraphNodeView) {
  if (["failed", "exhausted"].includes(node.logicalState) || node.currentAttempt?.state === "failed") return "failed";
  if (node.logicalState === "succeeded") return "complete";
  if (["cancelled", "not_run", "invalidated"].includes(node.logicalState)) return "stopped";
  if (node.currentAttempt?.state === "running") return "running";
  if (node.blocker && node.blocker.category !== "none") return "blocked";
  return "queued";
}
