import { z } from "zod/v4";

/** Frozen run/revision flags. Missing legacy flags retain their all-off meaning. */
export const taskGraphExperimentsSchema = z.object({
  decisionContinuations: z.boolean().default(false),
  semanticPartitioning: z.boolean().default(false),
  questionGraph: z.boolean().default(false),
}).strict();
export type TaskGraphExperiments = z.infer<typeof taskGraphExperimentsSchema>;
export function resolveTaskGraphExperiments(value?: unknown): TaskGraphExperiments {
  const parsed = taskGraphExperimentsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : taskGraphExperimentsSchema.parse({});
}

/** Project defaults apply only when starting a new primary iteration. */
export const taskGraphExperimentSettingsSchema = taskGraphExperimentsSchema.extend({
  decisionContinuations: z.boolean().default(true),
});
export function resolveTaskGraphExperimentSettings(value?: unknown): TaskGraphExperiments {
  const parsed = taskGraphExperimentSettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : taskGraphExperimentSettingsSchema.parse({});
}
export function hasTaskGraphExperiments(value?: unknown): boolean {
  return Object.values(resolveTaskGraphExperiments(value)).some(Boolean);
}

const boundedText = z.string().trim().min(1).max(1500);
export const graphPlanningAnalysisSchema = z.object({
  semanticPartitions: z.array(z.object({
    stepKey: z.string().min(1),
    obligations: z.array(boundedText).min(1).max(20),
    interfaces: z.array(boundedText).max(20),
    rationale: boundedText,
  }).strict()).max(100).optional(),
  discovery: z.object({
    questions: z.array(z.object({
      id: z.string().min(1).max(100),
      question: boundedText,
      decision: boundedText,
      evidence: boundedText,
      probe: boundedText,
      stopCondition: boundedText,
      status: z.enum(["resolved", "probe_required"]),
      resolution: boundedText.optional(),
      probeStepKey: z.string().min(1).optional(),
      consumerStepKeys: z.array(z.string().min(1)).min(1).max(100),
    }).strict()).max(12),
    budget: boundedText,
    stopReason: boundedText,
  }).strict().optional(),
}).strict();

/** One vocabulary across base prompts, procedures, preview, workers and repair. */
export function graphExperimentGuidance(value: unknown, phase: string): string {
  const flags = resolveTaskGraphExperiments(value);
  if (!hasTaskGraphExperiments(flags)) return "";
  const worker = phase === "worker" || phase === "verifier";
  const planning = ["leader", "graph_authoring", "dialectic"].includes(phase);
  return [
    `Task Graph experimental treatment v1 (${phase}): ${JSON.stringify(flags)}. These flags are frozen for this run; preserve all ownership, approval, source and verification requirements. The following guidance applies only when using a graph; it does not require creating one.`,
    flags.decisionContinuations ? (worker
      ? "Report actionable changes: committed output identities, checked acceptance clauses, concrete counterexamples and unresolved decisions. Avoid repeated unchanged progress. Use report_blocked for an actual decision; a normal dependency wait is not a failure. Do not claim completion before required outputs and checks."
      : "For graph work, make the next decision explicit: start, integrate, repair, moderate, or finish. get_graph_plan defaults to a bounded decision view; use nodeOffset for remaining pages and detail=full for canonical contracts/history when needed. Omitted or truncated evidence is not acceptance. After useful unowned work, if children remain active call wait_and_continue with duration_seconds=600, wake_on=all_terminal and a reason naming the next decision, THEN end the turn. Never end an unarmed waiting turn, poll with shell sleeps, or re-read unchanged status. Terminal/attention events resume the leader early. On wake match run/proposal/revision identities to the current graph before acting; fetch only missing evidence. Preserve independent verification and inspect all unresolved obligations before finalization.") : "",
    flags.semanticPartitioning ? (worker
      ? "Consume the assigned semantic obligations and interface contracts before editing. Keep original error types, timing, ordering, cardinality and side effects intact. Check boundary behavior with executable examples. If an invariant crosses ownership, report its exact conflict and implicated scopes; do not independently redesign the shared interface or expand writes. Final evidence maps each assigned obligation to a check and identifies remaining boundary risks."
      : !planning ? "Preserve the existing semantic obligation/interface map during review, integration, repair and reconciliation. Check original cross-boundary behavior; repair only implicated authorized scopes. Do not repartition or repeat domain reconstruction without new evidence."
      : "Before authoring, map original acceptance clauses/invariants to state transitions, symbols and effects. Partition by semantic coupling, not file count: keep jointly reasoned laws together; cut at small executable interfaces. Use one owner when a split duplicates the same domain reasoning. In plan.planningAnalysis.semanticPartitions include one entry per step with stepKey, original obligations, interfaces with executable boundary checks, and rationale. Ownership stays explicit and disjoint. Reuse the map in dispatch, integration and repair; change only the implicated boundary in a fenced successor, never mutate an active graph.") : "",
    flags.questionGraph ? (worker
      ? "Consume resolved questions and probe evidence rather than repeating reconnaissance. For an assigned probe, answer the named question with source/command evidence, the decision it changes and remaining uncertainty; obey its budget and stop condition, then stage the declared result. Consumers must read immutable probe artifacts before dependent work. New consequential unknowns need a discriminating probe or a concrete blocker, not unbounded exploration. Verifiers check evidence independently; a producer's confidence is not resolution."
      : !planning ? "Review existing decision questions and immutable probe evidence. Consumers must inspect probe artifacts before dependent work. Resolve concrete new unknowns within the declared budget or report a blocker; do not repeat resolved probes. Closure must account for unresolved decision questions."
      : "Before implementation, identify at most 12 unknowns whose answers could change architecture, ownership, acceptance or tests. Briefly sweep time, ordering, cardinality, representation, failure, composition and resource topology; probe only decision-relevant unknowns. Record plan.planningAnalysis.discovery with questions, a bounded budget and stopReason. Each question names id, question, decision, evidence, probe, stopCondition, status and consumerStepKeys. Resolved questions require resolution. probe_required questions require a bounded probeStepKey with an explicit numeric token or cost budgetRequest and direct immutable artifact dependencies from that probe to every consumer. Start with a small exploration budget (about 5% of the run); do not create generic research/review nodes or spend it when no consequential unknown remains. Empty questions plus a reason is valid. For submit_dialectic_graph supply the same planningAnalysis against generated keys turn-a-N, turn-b-N and synthesis-N at checkpoint rounds; use submit_graph_plan when independent probe steps are needed. Reserve plan.questions for decisions actually requiring user input, not self-resolvable unknowns. After probes, integrate evidence or author a bounded successor if it changes the partition; never implement a disputed assumption as if resolved.") : "",
    phase === "verifier" ? "Independently test original obligations and cross-interface behavior. Separate failed behavior, invalid test premises and unavailable evidence. Return the existing exact verdict schema; do not add fields or convert missing evidence into passed." : "",
    ["adjudication", "cancellation_recovery", "reconciliation"].includes(phase)
      ? "Preserve valid committed artifacts and resolved questions. Repair from the smallest concrete counterexample and original obligation; do not repeat unchanged failed checks. Reconcile actual acceptance and unresolved questions before closure. Experimental guidance never waives a required check." : "",
  ].filter(Boolean).join("\n\n");
}
