import { describe, expect, it } from "vitest";
import type { WorkItemRunSnapshot } from "../shared/work-item-contracts.ts";
import { createGraphFixture } from "./task-graph/fixtures.ts";
import { childRunContext } from "./work-item-run-context.ts";

const run: WorkItemRunSnapshot = { runKey: "child", workItemId: "work", runKind: "child",
  parentRunKey: "parent", taskId: "node-0", attemptId: "attempt-0-1", attemptNumber: 1,
  runNumber: null, previousRunKey: null, providerSessionId: null, outcome: "completed",
  startedAt: 1, endedAt: 2, finalReport: null };

describe("childRunContext", () => {
  it("uses the run's own attempt, not the latest retry, for harness and model", () => {
    const node = createGraphFixture(1).nodes[0]!;
    const context = childRunContext(run, { graphNodes: [{ ...node,
      objective: "Check\n  regressions", currentAttempt: { ...node.currentAttempt!, model: "new-model" },
      attemptHistory: [{ ...node.attemptHistory[0]!, harness: "codex", model: "original-model" }],
    }] });
    expect(context).toMatchObject({ label: "Child run · Task 0", objective: "Check regressions",
      details: "Attempt 1 · codex · original-model", inspectNodeId: "node-0" });
    expect(context.details).not.toContain("new-model");
  });

  it("does not claim an executor when the matching attempt is unavailable", () => {
    const node = createGraphFixture(1).nodes[0]!;
    expect(childRunContext({ ...run, attemptId: "missing" }, { graphNodes: [{ ...node,
      currentAttempt: { ...node.currentAttempt!, harness: "pi", model: "other-model" },
    }] }).details).toBe("Attempt 1");
  });

  it("falls back to task descriptions and does not expose opaque ids when metadata is missing", () => {
    expect(childRunContext(run, { taskPlan: [{ taskId: "node-0", title: "Audit tests",
      description: "Review the new tests" }] })).toMatchObject({ label: "Child run · Audit tests",
      objective: "Review the new tests", details: "Attempt 1", inspectNodeId: undefined });
    expect(childRunContext(run, {})).toMatchObject({ label: "Child run", objective: undefined,
      details: "Attempt 1", inspectNodeId: undefined });
  });
});
