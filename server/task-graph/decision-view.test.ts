import "./test-helpers.ts";
import { describe, expect, it } from "vitest";
import { graphSnapshotSchema } from "../../shared/task-graph-contracts.ts";
import { projectTaskGraphSnapshot } from "./view.ts";
import { contentHash } from "./hash.ts";
import { resolveTaskGraphExperiments } from "../../shared/task-graph-experiments.ts";
import type { TaskGraphPlanSnapshotView } from "../../shared/task-graph-planning-contracts.ts";
import type { TaskGraphNodeView, TaskGraphSnapshotView } from "../../shared/task-graph-view-contracts.ts";
import type { PlanningInspection } from "./planning-inspection.ts";
import { graphDecisionView } from "./decision-view.ts";

const flags = resolveTaskGraphExperiments({ decisionContinuations: true });
function node(id: string, overrides: Partial<TaskGraphNodeView> = {}): TaskGraphNodeView {
  return { id, title: id, logicalState: "pending", readiness: "not_ready", currentAttempt: null,
    blocker: null, verification: { state: "not_required", evidenceIds: [] },
    outputArtifactIds: [], ...overrides } as TaskGraphNodeView;
}
function inspection(state: TaskGraphPlanSnapshotView["state"] = "running",
  nodes: TaskGraphNodeView[] = [], status: TaskGraphSnapshotView["status"] = "running"): PlanningInspection {
  return { plan: { proposalId: "proposal", primaryRunKey: "primary", workItemId: "work",
    revision: 3, proposalRevision: 2, graphRunId: "graph", state, mode: "auto",
    canStart: false, autoStartEligible: true, questions: [], acceptanceCriteria: ["done"],
    reviewRequirements: [], steps: [], iteration: { strategy: "successor_revision", episode: 2,
      reason: "New evidence", evidenceRefs: ["artifact"], stopCondition: "Tests pass" } },
    runtime: { graphRunId: "graph", revision: 9, status, nodes }, history: [] } as unknown as PlanningInspection;
}

function canonicalVerification(state: "pending" | "passed" | "waived" | "running" | "accepted") {
  const hash = `sha256:${"a".repeat(64)}`;
  const facts = graphSnapshotSchema.parse({
    run: { id: "graph", workItemId: "work", primaryRunKey: "primary", revisionId: "revision",
      sourceSnapshotId: "source", status: "active", paused: false, revision: 9,
      maxActiveAttempts: 1, createdAt: 10, updatedAt: 20 },
    revision: { definitionId: "definition", revisionId: "revision", workItemId: "work",
      workspaceId: "workspace", objective: "Verify producer", acceptanceCriteria: ["done"],
      terminalNodeIds: ["producer"], maxActiveAttempts: 1, edges: [], nodes: [{
        id: "producer", title: "Producer", objective: "Produce", executorClass: "standard",
        allowedHarnesses: ["codex"], timeoutMs: 1000, retryPolicy: { maxAttempts: 1,
          backoffMs: 0, retryableOutcomes: [], jitterMs: 0 }, verificationRequired: true,
        failurePolicy: "fail_graph", expansionPolicy: null, outputSchemas: { result: { type: "object" } },
      }] },
    sourceSnapshot: { id: "source", workItemId: "work", primaryRunKey: "primary",
      taskGraphRevisionId: "revision", repositoryBaseCommit: "abc", dirtyDiffDigest: hash,
      workspaceId: "workspace", worktreeIdentity: "worktree", systemModelDigest: hash,
      workPacketRevisionId: null, connectedContext: [], compiledSkills: [],
      harnessPolicyDigest: hash, toolPolicyDigest: hash, createdAt: 1 },
    attempts: [{ id: "attempt", node_id: "producer", attempt_number: 1,
      runtime: state === "running" ? "running" : "terminal",
      outcome: state === "running" ? "none" : "succeeded", created_at: 11, updated_at: 12 }],
    artifacts: state === "running" ? [] : [{ id: "artifact", node_id: "producer",
      producer_attempt_id: "attempt", state: "committed", output_name: "result", source_snapshot_id: "source" }],
    verifications: ["passed", "waived"].includes(state) ? [{ id: "check", producer_attempt_id: "attempt",
      verifier_attempt_id: "verifier", result: state }] : [],
    adjudications: state === "accepted" ? [{ node_id: "producer", attempt_id: "attempt",
      source_snapshot_id: "source", acceptance_criteria_version: contentHash([]),
      decision: "accepted", actor: "leader", reason: "Checked independently", created_at: 20 }] : [],
    verificationRequests: [], humanInputs: [], edgeEvaluations: [], reservations: [], joins: [],
    outbox: [], schedulerLease: null, expansions: [], reductions: [], reconciliations: [],
    steeringEvents: [], invalidations: [], usage: [], events: [],
  });
  return projectTaskGraphSnapshot(facts, [{ nodeId: "producer", ready: false,
    reason: "attempt_succeeded_pending_satisfaction" }], 30);
}

describe("graph OODA decision evidence", () => {
  it.each(["pending", "passed", "waived", "running", "accepted"] as const)(
    "uses canonical attempt and satisfaction facts for %s verification", state => {
      const current = inspection(); current.runtime = canonicalVerification(state);
      const producer = current.runtime.nodes[0]!;
      if (state === "pending") expect(producer).toMatchObject({ logicalState: "pending",
        currentAttempt: { state: "succeeded" }, verification: { state: "pending" }, blocker: null });
      const signals = graphDecisionView(current, flags).ooda.signals;
      if (state === "pending") expect(signals).toContain("verification");
      else expect(signals).not.toContain("verification");
    });
  it("allows continued execution without treating normal scheduler waits as strategy failure", () => {
    const view = graphDecisionView(inspection("running", [
      node("dependency", { blocker: { category: "dependency" } }),
      node("delay", { blocker: { category: "delay" } }),
      node("backoff", { blocker: { category: "backoff" } }),
      node("capacity", { blocker: { category: "capacity" } }),
    ], "quiescent"), flags);
    expect(view.ooda).toMatchObject({ phase: "orient", reviewRecommended: false, signals: [],
      choices: ["continue", "integrate", "repair", "replan"],
      successor: { baseProposalRevision: 2, episode: 3, requiresCancellation: true } });
    expect(view.nextDecision).toBe("reorient_or_continue");
  });

  it("detects consequential signals across all pages without auto-selecting replan", () => {
    const nodes = Array.from({ length: 15 }, (_, n) => node(`node-${n}`));
    nodes.push(node("budget", { blocker: { category: "budget" } }),
      node("policy", { blocker: { category: "policy" } }),
      node("input", { blocker: { category: "input" } }),
      node("bad-check", { verification: { state: "failed", evidenceIds: [] } }),
      node("failed", { logicalState: "exhausted" }));
    const current = inspection("running", nodes, "blocked");
    const first = graphDecisionView(current, flags);
    const second = graphDecisionView(current, flags, 10);
    expect(first.ooda).toMatchObject({ phase: "orient", reviewRecommended: true,
      signals: ["budget", "policy", "input", "verification", "failed_work"] });
    expect(second.ooda).toEqual(first.ooda);
    expect(first.ooda).not.toHaveProperty("selectedDecision");
    expect(first.ooda.successor!.requiresCancellation).toBe(true);
  });

  it("requires orientation after terminal execution without claiming acceptance", () => {
    const view = graphDecisionView(inspection("completed", [node("done", {
      logicalState: "pending", currentAttempt: { id: "attempt", number: 1, state: "succeeded",
        costUsd: 0, tokens: 0 }, verification: { state: "pending", evidenceIds: [] },
    })], "completed"), flags);
    expect(view.ooda).toMatchObject({ reviewRecommended: true,
      signals: ["verification", "terminal_run"],
      choices: ["integrate", "repair", "replan", "finish"],
      successor: { requiresCancellation: false } });
    expect(view.ooda.notice).toMatch(/not.*acceptance/i);
    expect(view.nextDecision).toBe("reorient_before_finish");
  });

  it.each(["failed", "cancelled"] as const)("keeps %s runs available for evidence-backed successors", (state) => {
    const view = graphDecisionView(inspection(state, [], state), flags);
    expect(view.ooda).toMatchObject({ reviewRecommended: true, signals: ["terminal_run"],
      successor: { requiresCancellation: false, baseProposalRevision: 2, episode: 3 } });
  });

  it("routes missing plans to authoring and ready plans to review rather than cancelling", () => {
    expect(graphDecisionView({ plan: null, runtime: null, history: [] }, flags).ooda)
      .toMatchObject({ phase: "decide", choices: ["author"], successor: null });
    const ready = inspection("ready"); ready.runtime = null; ready.plan!.graphRunId = null;
    expect(graphDecisionView(ready, flags).ooda).toMatchObject({ phase: "decide",
      choices: ["review_start", "revise"], successor: null });
  });

  it("offers only inspection for connected or historical read-only graphs", () => {
    const view = graphDecisionView(inspection(), flags, 0, true);
    expect(view.ooda).toMatchObject({ choices: ["inspect"], successor: null });
  });

  it("flags missing canonical runtime instead of inventing a cancellation fence", () => {
    const current = inspection(); current.runtime = null;
    expect(graphDecisionView(current, flags).ooda).toMatchObject({ reviewRecommended: true,
      signals: ["runtime_not_inspected"], successor: { requiresCancellation: null } });
  });
});
