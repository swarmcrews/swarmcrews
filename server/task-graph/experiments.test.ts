import "./test-helpers.ts";
import { describe, expect, it, vi } from "vitest";
import { resolveTaskGraphExperiments, graphExperimentGuidance } from "../../shared/task-graph-experiments.ts";
import { semanticTaskGraphPlanSchema } from "../../shared/task-graph-planning-contracts.ts";
import { graphRevisionInputSchema } from "../../shared/task-graph-contracts.ts";
import { composeLeaderPrompt } from "../../shared/leader-prompt.ts";
import { createLeaderProcedureTools } from "../leader-procedure-tools.ts";
import { LEADER_PROCEDURE_IDS } from "../../shared/leader-procedures.ts";
import { compileSemanticGraphPlan } from "./planning-compiler.ts";
import { renderTaskGraphNodePrompt } from "./node-prompt.ts";
import { renderVerificationPrompt } from "./verification-prompt.ts";
import { compatibleResumeId, resolvePrimaryRunConfig } from "../work-item-run-config.ts";
import { graphDecisionView } from "./decision-view.ts";
import type { PlanningInspection } from "./planning-inspection.ts";
import { initDb } from "../db.ts";
import { ensureWorkItemSchema } from "../work-item-schema.ts";
import { taskGraphExperimentsForRun } from "./planning-mode.ts";
import { createTaskGraphPlanningTools } from "./planning-tools.ts";
import type { TaskGraphPlanningCoordinator } from "./planning-coordinator.ts";

function plan() {
  return semanticTaskGraphPlanSchema.parse({ objective: "Implement fenced transitions", acceptanceCriteria: ["Expiry equality rejects stale writes"],
    planningAnalysis: {
      semanticPartitions: ["probe", "build"].map(stepKey => ({ stepKey, obligations: ["Original expiry equality clause"],
        interfaces: ["Test now == leaseUntil"], rationale: "Keep transition invariants together" })),
      discovery: { budget: "One bounded probe", stopReason: "Stop after the boundary is observed", questions: [{
        id: "expiry", question: "Which boundary applies?", decision: "Choose the transition guard", evidence: "Original public clause",
        probe: "Execute the equality case", stopCondition: "One reproducible observation", status: "probe_required", probeStepKey: "probe", consumerStepKeys: ["build"],
      }] },
    },
    steps: [
      { key: "probe", title: "Probe", objective: "Check boundary", acceptanceCriteria: ["Evidence returned"],
        executorClass: "standard", budgetRequest: { tokens: 1000 }, outputSchemas: { result: { type: "object" } } },
      { key: "build", title: "Build", objective: "Implement", acceptanceCriteria: ["Expiry clause checked"],
        executorClass: "standard", inputBindings: { boundary: { type: "object" } }, dependsOn: [{
          stepKey: "probe", kind: "artifact", sourceOutput: "result", targetInput: "boundary", satisfactionPolicy: "all_success", failurePolicy: "block", optional: false,
        }] },
    ],
  });
}
function compile(flags: unknown, value = plan()) {
  return compileSemanticGraphPlan({ workItemId: "work", workspaceId: "workspace", primaryRunKey: "primary", proposalRevision: 1,
    defaultHarness: "codex", defaultAllowedTools: [], plan: value, experiments: resolveTaskGraphExperiments(flags) });
}

describe("frozen Task Graph experiments", () => {
  it("keeps missing frozen flags in legacy runs off and never interprets truthy strings as enablement", () => {
    expect(graphExperimentGuidance(undefined, "leader")).toBe("");
    expect(resolveTaskGraphExperiments({ questionGraph: "true" }).questionGraph).toBe(false);
    const value = plan(); delete value.planningAnalysis;
    expect(compile({}, value).revision.taskGraphExperiments).toBeUndefined();
    expect(compile({}, value).revision.planningAnalysis).toBeUndefined();
  });

  it.each(Array.from({ length: 8 }, (_, n) => n))("routes treatment mask %i through base, every lifecycle, workers and auxiliary verifiers", async mask => {
    const flags = resolveTaskGraphExperiments({ decisionContinuations: Boolean(mask & 4), semanticPartitioning: Boolean(mask & 2), questionGraph: Boolean(mask & 1) });
    const revision = graphRevisionInputSchema.parse(JSON.parse(JSON.stringify(compile(flags).revision)));
    const task = revision.nodes[1]!;
    const base = composeLeaderPrompt({ builtInTools: [], registeredToolNames: [], taskGraphExperiments: flags });
    const worker = renderTaskGraphNodePrompt(revision, task, "attempt", 1, "source", [], [], []);
    const verifier = renderVerificationPrompt(task, { id: "producer" }, [], "source", revision, []);
    for (const prompt of [base, worker, verifier]) {
      expect(prompt.includes("Task Graph experimental treatment v1")).toBe(mask !== 0);
    }
    expect(worker.includes("Assigned semantic obligations and interfaces")).toBe(flags.semanticPartitioning);
    expect(worker.includes("Decision questions (read listed probe artifacts")).toBe(flags.questionGraph);
    expect(verifier).toContain("Verification is read-only");
    expect(verifier).toContain('Only result="passed" satisfies this node');
    for (const id of LEADER_PROCEDURE_IDS) {
      const result = await createLeaderProcedureTools(flags)[0]!.handler({ id });
      expect(JSON.stringify(result).includes("Task Graph experimental treatment v1")).toBe(mask !== 0);
    }
  });

  it("rejects missing/duplicate semantic ownership maps without weakening ordinary ownership validation", () => {
    const value = plan(); delete value.planningAnalysis;
    expect(() => compile({ semanticPartitioning: true }, value)).toThrow("exactly one");
    const duplicate = plan(); duplicate.planningAnalysis!.semanticPartitions![1]!.stepKey = "probe";
    expect(() => compile({ semanticPartitioning: true }, duplicate)).toThrow("exactly one");
  });

  it("requires evidence or a nonoptional probe artifact for every affected consumer", () => {
    const value = plan(); value.steps[1]!.dependsOn[0]!.optional = true;
    expect(() => compile({ questionGraph: true }, value)).toThrow("nonoptional all_success artifact");
    const resolved = plan(); resolved.planningAnalysis!.discovery!.questions[0]!.status = "resolved";
    expect(() => compile({ questionGraph: true }, resolved)).toThrow("resolution evidence");
    const empty = plan(); empty.planningAnalysis!.discovery!.questions = [];
    expect(() => compile({ questionGraph: true }, empty)).not.toThrow();
    const unbounded = plan(); unbounded.steps[0]!.budgetRequest = {};
    expect(() => compile({ questionGraph: true }, unbounded)).toThrow("explicit numeric");
    expect(compile({ questionGraph: true }).revision.edges[0]!.kind).toBe("artifact");
  });

  it("changes canonical identity with treatment and freezes config across resume", () => {
    expect(compile({}).revision.revisionId).not.toBe(compile({ questionGraph: true }).revision.revisionId);
    const started = resolvePrimaryRunConfig(null, { harness: "codex", taskGraphExperiments: { questionGraph: true } });
    const resumed = resolvePrimaryRunConfig(started.json, { prompt: "Continue" });
    expect(resumed.config.taskGraphExperiments?.questionGraph).toBe(true);
    const previous = { session_id: "thread", harness_name: "codex", run_config_json: started.json };
    expect(compatibleResumeId(previous, resumed.config)).toBe("thread");
    expect(compatibleResumeId(previous, { harness: "codex", taskGraphExperiments: resolveTaskGraphExperiments() })).toBeUndefined();
    const db = initDb(":memory:"); ensureWorkItemSchema(db);
    db.prepare("INSERT INTO sessions(session_key,run_config_json) VALUES (?,?)").run("run", started.json);
    expect(taskGraphExperimentsForRun(db, "run").questionGraph).toBe(true);
    expect(taskGraphExperimentsForRun(db, "legacy").questionGraph).toBe(false);
    db.close();
  });

  it("bounds decision payloads, prioritizes blockers and paginates without leaking context/history", () => {
    const nodes = Array.from({ length: 25 }, (_, n) => ({ id: `n${n}`, title: "x".repeat(10000), logicalState: "succeeded", readiness: "terminal",
      currentAttempt: null, blocker: null, verification: { state: "passed" }, outputArtifactIds: [], context: [{ content: "SECRET_CONTEXT" }] }));
    nodes[24] = { ...nodes[24]!, logicalState: "failed" };
    const inspection = { plan: null, runtime: { graphRunId: "g", revision: 8, status: "blocked", nodes }, history: [{ text: "HISTORY" }] } as unknown as PlanningInspection;
    const flags = resolveTaskGraphExperiments({ decisionContinuations: true });
    const first = graphDecisionView(inspection, flags);
    expect(first.runtime!.nodes[0]!.id).toBe("n24");
    expect(first.runtime!.nodes).toHaveLength(10);
    expect(first.pagination.nextNodeOffset).toBe(10);
    expect(graphDecisionView(inspection, flags, 20).runtime!.nodes).toHaveLength(5);
    expect(JSON.stringify(first)).not.toContain("SECRET_CONTEXT");
    expect(JSON.stringify(first)).not.toContain("HISTORY");
    expect(JSON.stringify(first).length).toBeLessThan(12000);
  });

  it("uses the decision view only in the treatment and retains explicit full inspection", async () => {
    const inspection = { plan: null, runtime: null, history: [{ objective: "FULL_HISTORY_MARKER" }] } as unknown as PlanningInspection;
    const coordinator = { inspection: vi.fn(() => inspection), options: { resolveSourceAuthority: () => null } } as unknown as TaskGraphPlanningCoordinator;
    const tool = (enabled: boolean) => createTaskGraphPlanningTools({ coordinator, workItemId: "work", primaryRunKey: "primary",
      leaderSessionKey: "primary", mode: "auto", experiments: resolveTaskGraphExperiments({ decisionContinuations: enabled }) })
      .find(t => t.name === "get_graph_plan")!;
    expect(JSON.stringify(await tool(true).handler({}))).not.toContain("FULL_HISTORY_MARKER");
    expect(JSON.stringify(await tool(true).handler({ detail: "full" }))).toContain("FULL_HISTORY_MARKER");
    expect(JSON.stringify(await tool(false).handler({}))).toContain("FULL_HISTORY_MARKER");
    expect(coordinator.inspection).toHaveBeenLastCalledWith("work", "primary", { historyLimit: 20 });
  });
});
