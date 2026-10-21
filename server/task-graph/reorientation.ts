import type { LeaderProcedureId } from "../../shared/leader-procedures.ts";
import type { PlanningInspection } from "./planning-inspection.ts";

const terminalStates = new Set(["completed", "failed", "cancelled"]);

export function graphInspectionProcedure(inspection: PlanningInspection): LeaderProcedureId {
  if (!inspection.plan && !inspection.runtime) return "graph_authoring";
  if (inspection.plan && ["ready", "needs_input", "starting"].includes(inspection.plan.state)) {
    return "review_start";
  }
  return "reorientation";
}

/** Advisory OODA routing, not a strategy verdict, acceptance check or mutation grant. */
export function graphOrientation(inspection: PlanningInspection, readOnly = false) {
  const { plan, runtime } = inspection;
  const nodes = runtime?.nodes ?? [];
  const signals: string[] = [];
  for (const category of ["budget", "policy", "input"] as const) {
    if (nodes.some(node => node.blocker?.category === category)) signals.push(category);
  }
  if (nodes.some(node => node.blocker?.category === "verification"
    || ["failed", "stale"].includes(node.verification.state)
    // Logical success already includes verification/accepted adjudication. A
    // successful execution still awaiting verification remains logically pending.
    || (node.logicalState === "pending" && node.currentAttempt?.state === "succeeded"
      && node.verification.state === "pending"))) {
    signals.push("verification");
  }
  if (nodes.some(node => ["failed", "exhausted", "invalidated"].includes(node.logicalState))) {
    signals.push("failed_work");
  }
  const terminal = terminalStates.has(runtime?.status ?? plan?.state ?? "");
  if (terminal) signals.push("terminal_run");
  if (plan?.state === "stale") signals.push("source_drift");
  if (plan?.graphRunId && !runtime) signals.push("runtime_not_inspected");
  if (runtime?.status === "blocked" && signals.length === 0
    && !nodes.some(node => node.blocker && node.blocker.category !== "none")) {
    signals.push("unexplained_block");
  }
  const procedure = graphInspectionProcedure(inspection);
  const choices = readOnly ? ["inspect"] : procedure === "graph_authoring" ? ["author"]
    : procedure === "review_start" ? ["review_start", "revise"]
      : terminal ? ["integrate", "repair", "replan", "finish"]
        : ["continue", "integrate", "repair", "replan"];
  return {
    phase: procedure === "reorientation" ? "orient" : "decide",
    reviewRecommended: signals.length > 0,
    signals,
    choices,
    successor: !readOnly && plan?.graphRunId ? {
      baseProposalRevision: plan.proposalRevision,
      episode: (plan.iteration?.episode ?? 1) + 1,
      requiresCancellation: runtime ? !terminalStates.has(runtime.status) : terminal ? false : null,
    } : null,
    notice: "Advisory OODA routing, not acceptance or permission. Observe canonical evidence, orient against the objective, decide explicitly, then act through fenced controls. New evidence or guidance may require reorientation even when no signal is shown.",
  };
}
