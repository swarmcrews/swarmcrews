import { describe, expect, it } from "vitest";
import type { TaskGraphSnapshotView } from "../../shared/task-graph-view-contracts.ts";
import { hasActiveGraphExecution } from "./work-item-activity.ts";

function view(status: TaskGraphSnapshotView["status"], attempt?: string): TaskGraphSnapshotView {
  // Only execution fields matter; topology and report content do not.
  return { status, nodes: attempt ? [{ currentAttempt: { state: attempt } }] : [] } as TaskGraphSnapshotView;
}

describe("graph activity excludes decision waits", () => {
  it.each(["running", "quiescent"] as const)("treats %s as automatic work even before dispatch", (status) => {
    expect(hasActiveGraphExecution(view(status))).toBe(true);
  });
  it.each(["paused", "blocked", "completed", "failed", "cancelled"] as const)("allows a decision for a halted %s graph", (status) => {
    expect(hasActiveGraphExecution(view(status))).toBe(false);
  });
  it.each(["queued", "running", "backoff"])("does not mistake a paused graph with a %s child for halted work", (attempt) => {
    expect(hasActiveGraphExecution(view("paused", attempt))).toBe(true);
  });
  it("allows a blocked graph with no runnable children to ask for input", () => {
    expect(hasActiveGraphExecution(view("blocked", "blocked"))).toBe(false);
  });
});
