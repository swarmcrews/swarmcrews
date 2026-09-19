import type { SemanticTaskGraphPlan } from "../../shared/task-graph-planning-contracts.ts";
import type { TaskGraphExperiments } from "../../shared/task-graph-experiments.ts";
import { TaskGraphValidationError } from "./errors.ts";

/** Structural guarantees only: models/verifiers still judge semantic fidelity. */
export function validateExperimentPlanning(plan: SemanticTaskGraphPlan, flags: TaskGraphExperiments): void {
  const steps = new Map(plan.steps.map(step => [step.key, step]));
  const fail = (message: string): never => { throw new TaskGraphValidationError(message); };
  if (flags.semanticPartitioning) {
    const partitions = plan.planningAnalysis?.semanticPartitions;
    if (!partitions || partitions.length !== steps.size
      || new Set(partitions.map(p => p.stepKey)).size !== steps.size
      || partitions.some(p => !steps.has(p.stepKey))) {
      fail("semanticPartitioning requires planningAnalysis.semanticPartitions with exactly one obligation/interface/rationale entry for every step");
    }
  }
  if (flags.questionGraph) {
    const discovery = plan.planningAnalysis?.discovery;
    if (!discovery) fail("questionGraph requires planningAnalysis.discovery; use empty questions with budget and stopReason when no consequential unknown remains");
    const questions = discovery!.questions;
    if (new Set(questions.map(q => q.id)).size !== questions.length) fail("discovery question IDs must be unique");
    for (const q of questions) {
      if (q.consumerStepKeys.some(key => !steps.has(key))) fail(`question ${q.id} has an unknown consumer`);
      if (q.status === "resolved") {
        if (!q.resolution) fail(`resolved question ${q.id} requires resolution evidence`);
        continue;
      }
      const probe = q.probeStepKey ? steps.get(q.probeStepKey) : undefined;
      if (!probe || q.consumerStepKeys.includes(probe.key)) fail(`question ${q.id} requires a separate probeStepKey`);
      if (!Object.keys(probe!.budgetRequest).some(key => ["tokens", "maxTokens", "costMicros", "maxCostMicros"].includes(key))) {
        fail(`question ${q.id} probe requires an explicit numeric token or cost budget`);
      }
      if (!Object.keys(probe!.outputSchemas).length) fail(`question ${q.id} probe requires a declared result artifact`);
      for (const key of q.consumerStepKeys) {
        const consumer = steps.get(key)!;
        const bound = consumer.dependsOn.some(d => d.stepKey === probe!.key
          && (d.kind === "artifact" || d.kind === "verified_artifact") && !d.optional
          && d.satisfactionPolicy === "all_success"
          && d.sourceOutput && d.targetInput
          && Object.hasOwn(probe!.outputSchemas, d.sourceOutput)
          && Object.hasOwn(consumer.inputBindings, d.targetInput));
        if (!bound) fail(`question ${q.id}: consumer ${key} requires a nonoptional all_success artifact dependency on probe ${probe!.key}`);
      }
    }
  }
}
