import type { PlanningInspection } from "./planning-inspection.ts";
import { resolveTaskGraphExperiments, type TaskGraphExperiments } from "../../shared/task-graph-experiments.ts";

const brief = (value: string | null | undefined) => value ? value.slice(0, 600) : null;

/** Bounded routing evidence, never a replacement for contracts or verification. */
export function graphDecisionView(inspection: PlanningInspection, experiments: TaskGraphExperiments, nodeOffset = 0) {
  const { plan, runtime } = inspection;
  const nodes = [...(runtime?.nodes ?? [])].sort((a, b) => {
    const priority = (n: typeof a) => n.blocker?.category && n.blocker.category !== "none"
      || ["failed", "exhausted", "invalidated"].includes(n.logicalState) ? 0 : n.logicalState === "succeeded" ? 2 : 1;
    return priority(a) - priority(b) || a.id.localeCompare(b.id);
  });
  return {
    detail: "decision", treatment: { version: 1, flags: runtime ? resolveTaskGraphExperiments(runtime.taskGraphExperiments) : experiments },
    plan: plan ? {
      proposalId: plan.proposalId, primaryRunKey: plan.primaryRunKey, workItemId: plan.workItemId,
      revision: plan.revision, proposalRevision: plan.proposalRevision, graphRunId: plan.graphRunId,
      state: plan.state, mode: plan.mode, canStart: plan.canStart, autoStartEligible: plan.autoStartEligible,
      sourceSnapshotId: plan.sourceSnapshotId, workPacketId: plan.workPacketId,
      error: brief(plan.error), questions: plan.questions.map(brief),
      acceptanceCount: plan.acceptanceCriteria.length,
      reviewRequirementCount: plan.reviewRequirements.length,
      reviewRequirements: plan.reviewRequirements.slice(0, 10).map(r => ({ gateId: r.gateId, name: brief(r.name), reason: brief(r.reason) })),
      stepCount: plan.steps.length,
    } : null,
    runtime: runtime ? {
      graphRunId: runtime.graphRunId, revision: runtime.revision, status: runtime.status,
      counts: nodes.reduce<Record<string, number>>((counts, node) => {
        counts[node.logicalState] = (counts[node.logicalState] ?? 0) + 1; return counts;
      }, {}),
      nodes: nodes.slice(nodeOffset, nodeOffset + 10).map(n => ({
        id: n.id, title: brief(n.title), logicalState: n.logicalState, readiness: n.readiness,
        attemptId: n.currentAttempt?.id ?? null,
        blocker: n.blocker ? { category: n.blocker.category, explanation: brief(n.blocker.explanation) } : null,
        verification: { state: n.verification.state, explanation: brief(n.verification.explanation) },
        artifactIds: n.outputArtifactIds.slice(0, 10), artifactCount: n.outputArtifactIds.length,
      })),
    } : null,
    pagination: { nodeOffset, totalNodes: nodes.length, nextNodeOffset: nodeOffset + 10 < nodes.length ? nodeOffset + 10 : null },
    evidenceNotice: "Decision view omits contracts, history, artifact contents and long explanations. Read every needed page and use detail=full for canonical evidence; omission never means acceptance.",
    nextDecision: !plan ? "author" : plan.state === "ready" || plan.state === "needs_input" ? "review_start"
      : plan.state === "running" ? "work_or_durable_wait" : "inspect_evidence_and_repair_or_finish",
  };
}
