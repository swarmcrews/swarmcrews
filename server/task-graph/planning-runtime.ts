import { CONNECTION_MCP_TOOLS } from "../../shared/mcp-servers/connections.ts";
import type Database from "better-sqlite3";
import { taskGraphExperimentsForRun } from "./planning-mode.ts";
import { graphDecisionView } from "./decision-view.ts";
import { graphExperimentGuidance } from "../../shared/task-graph-experiments.ts";
import type { Bus } from "../bus.ts";
import type { TaskGraphPlanSnapshotView } from "../../shared/task-graph-planning-contracts.ts";
import { getSessionCanvasContext } from "../canvas-context-store.ts";
import { connectedGraphSourcesForRecipient } from "./connected-graph-source.ts";
import { refreshConnectedGraphContext } from "./connected-graph-context.ts";
import { getHarness } from "../harness/index.ts";
import { readSettings } from "../project-store.ts";
import type { SessionRegistry } from "../session-registry.ts";
import type { SessionHostDeps } from "../session-host-types.ts";
import { requestWaitResume } from "../wait-resume.ts";
import { findWorkspaceBySource } from "../workspace-registry.ts";
import { minionSkillMcpToolNames } from "../agents/minion-tool-policy.ts";
import { TaskGraphPlanningCoordinator } from "./planning-coordinator.ts";
import { leaderOrchestrationModeForRun, planningContextForRun } from "./planning-mode.ts";
import type { TaskGraphService } from "./service.ts";
import { leaderProcedurePointer } from "../../shared/leader-procedures.ts";

export function installTaskGraphPlanningRuntime(input: {
  db: Database.Database;
  bus: Bus;
  registry: SessionRegistry;
  sessionDeps: SessionHostDeps;
  taskGraphs: TaskGraphService;
}): TaskGraphPlanningCoordinator {
  let coordinator: TaskGraphPlanningCoordinator;
  const terminalWakePending = new Set<string>();
  coordinator = new TaskGraphPlanningCoordinator({
    db: input.db,
    bus: input.bus,
    taskGraphs: input.taskGraphs,
    resolveSourceAuthority: (workItemId, primaryRunKey) => {
      const host = input.registry.get(primaryRunKey);
      if (!host || host.workItemId !== workItemId || host.runKind !== "primary") return null;
      const projectPath = host.worktree?.projectPath ?? host.cwd;
      const workspace = findWorkspaceBySource(projectPath);
      if (!workspace) return null;
      // Graph steps are Minions: freeze their configured provider into the plan,
      // independently of the Leader's provider, just as direct assignment does.
      const minionHarness = readSettings(projectPath).defaultMinionHarness || "claude";
      return {
        taskGraphExperiments: taskGraphExperimentsForRun(input.db, primaryRunKey),
        workspaceId: workspace.id,
        cwd: host.cwd,
        projectPath,
        worktreeIdentity: host.worktree
          ? `${host.worktree.branch}:${host.worktree.path}` : `workspace:${workspace.id}`,
        connectedContext: getSessionCanvasContext(primaryRunKey)
          ?? planningContextForRun(input.db, primaryRunKey),
        // The saved Full canvas edge and active surface bindings are checked
        // for every tool invocation; in-memory browser delivery is not a grant.
        connectedGraphSources: connectedGraphSourcesForRecipient(input.db, { workItemId, primaryRunKey }),
        skillIds: host.skillIds,
        skillSnapshotId: host.skillSnapshotId,
        skillValues: host.skillValues,
        harnessName: minionHarness,
        allowedTools: host.toolAllowlist ?? [
          ...getHarness(minionHarness).builtInTools,
          ...minionSkillMcpToolNames(host.skillIds), ...CONNECTION_MCP_TOOLS,
        ],
      };
    },
    onTerminal: (plan) => {
      const host = input.registry.get(plan.primaryRunKey);
      if (!host) return;
      const flags = taskGraphExperimentsForRun(input.db, plan.primaryRunKey);
      if (flags.decisionContinuations && !isCurrentPlan(coordinator, plan)) return;
      const wakeId = plan.graphRunId ?? plan.proposalId;
      if (terminalWakePending.has(wakeId)) return;
      terminalWakePending.add(wakeId);
      requestWaitResume(host, input.sessionDeps, {
        immediate: true,
        idempotencyKey: `graph-terminal:${wakeId}:${plan.state}`,
        completedReason: `Execution graph ${plan.state}`,
        onDelivered: () => {
          if (plan.graphRunId) coordinator.acknowledgeTerminalWake(
            plan.proposalId, plan.graphRunId,
          );
          terminalWakePending.delete(wakeId);
        },
        opts: {
          sessionKey: host.id,
          invocationKind: "resume_open_run",
          prompt: flags.decisionContinuations ? decisionContinuation(coordinator, plan, flags) : `The execution graph is now ${plan.state}. Call get_graph_plan, inspect the canonical runtime, acceptance coverage, committed artifacts and independent verification. Identify unfinished obligations and failed or inconclusive checks; remediate within authorized scope or report the concrete blocker before finalizing. Synthesize the final response only when the objective is satisfied or honestly explain why it remains incomplete. ${leaderProcedurePointer("adjudication")} If a Work Packet is associated, load the reconciliation procedure before closure.`,
          cwd: host.cwd,
          resumeId: host.sessionId ?? undefined,
          harness: host.harnessName,
          role: host.role,
        },
      });
    },
    onAttention: (plan, _reason, runRevision) => {
      const host = input.registry.get(plan.primaryRunKey);
      if (!host) return;
      const flags = taskGraphExperimentsForRun(input.db, plan.primaryRunKey);
      if (flags.decisionContinuations && !isCurrentPlan(coordinator, plan)) return;
      const prompt = [flags.decisionContinuations ? decisionContinuation(coordinator, plan, flags) : "",
        attentionPrompt(coordinator,input.taskGraphs,plan,runRevision)].filter(Boolean).join("\n\n");
      requestWaitResume(host, input.sessionDeps, {
        immediate: true,
        idempotencyKey: `graph-attention:${plan.graphRunId ?? plan.proposalId}:${runRevision}`,
        completedReason: "Execution graph needs attention",
        opts: {
          sessionKey: host.id,
          invocationKind: "resume_open_run",
          prompt,
          cwd: host.cwd,
          resumeId: host.sessionId ?? undefined,
          harness: host.harnessName,
          role: host.role,
        },
      });
    },
  });
  coordinator.addCleanup(input.bus.subscribe((envelope) => {
    if ((envelope.type !== "task_graph_snapshot" && envelope.type !== "task_graph_changed")
      || typeof envelope["runId"] !== "string") return;
    let graph: {workItemId:string;primaryRunKey:string};
    try { graph=input.taskGraphs.snapshot(envelope["runId"]).run; } catch { return; }
    for (const host of input.registry.values()) {
      if (!host.workItemId || host.runKind !== "primary") continue;
      refreshConnectedGraphContext(host, coordinator);
    }
  }));
  input.sessionDeps.getTaskGraphExperiments = (runKey) => taskGraphExperimentsForRun(input.db, runKey);
  input.sessionDeps.getLeaderOrchestrationMode = (runKey) =>
    leaderOrchestrationModeForRun(input.db, runKey);
  input.sessionDeps.getTaskGraphPlanning = () => coordinator;
  return coordinator;
}

function attentionPrompt(
  coordinator:TaskGraphPlanningCoordinator,
  taskGraphs:TaskGraphService,
  plan:TaskGraphPlanSnapshotView,
  runRevision:number,
):string {
  if (!plan.graphRunId) return genericAttentionPrompt;
  try {
    const graph=taskGraphs.snapshot(plan.graphRunId);
    const satisfied=new Set(graph.edgeEvaluations.filter(row=>Boolean(row["satisfied"]))
      .map(row=>String(row["edge_id"])));
    const gate=graph.revision.edges.find(edge=>edge.kind==="human_gate"
      &&!satisfied.has(edge.id)&&graph.revision.nodes.some(node=>node.id===edge.sourceNodeId
        &&node.reasoning?.kind==="dialectic"&&node.reasoning.phase==="synthesis"
        &&!node.reasoning.final));
    if (!gate) return genericAttentionPrompt;
    const artifact=graph.artifacts.find(row=>row["node_id"]===gate.sourceNodeId
      &&row["output_name"]==="synthesis"&&row["state"]==="committed");
    const report=artifact?coordinator.readArtifact({workItemId:plan.workItemId,
      primaryRunKey:plan.primaryRunKey,graphRunId:plan.graphRunId,
      artifactId:String(artifact["id"]),offset:0,maxBytes:16_384})["content"]:null;
    return [
      "A dialectic synthesis checkpoint is ready for Leader moderation.",
      `Checkpoint node: ${gate.sourceNodeId}. Expected graph revision: ${graph.run.revision||runRevision}.`,
      typeof report==="string"?`Synthesis report:\n${report}`:
        "Call get_graph_plan and read_graph_artifact to inspect the synthesis report.",
      "Evaluate goal distance and unresolved questions, then call moderate_dialectic to continue, reshape, or stop.",
    ].join("\n\n");
  } catch {
    return genericAttentionPrompt;
  }
}

const genericAttentionPrompt=`The execution graph is blocked. Call get_graph_plan, inspect the canonical blocker and evidence, then resolve it or ask the user one focused question. ${leaderProcedurePointer("adjudication")}`;

function isCurrentPlan(coordinator: TaskGraphPlanningCoordinator, plan: TaskGraphPlanSnapshotView): boolean {
  const current = coordinator.repo.latest(plan.workItemId, plan.primaryRunKey);
  return current?.proposalId === plan.proposalId && current.graphRunId === plan.graphRunId
    && current.revision === plan.revision;
}
function decisionContinuation(coordinator: TaskGraphPlanningCoordinator, plan: TaskGraphPlanSnapshotView,
  flags: ReturnType<typeof taskGraphExperimentsForRun>): string {
  const inspection = coordinator.inspection(plan.workItemId, plan.primaryRunKey,
    { ...(plan.graphRunId ? { graphRunId: plan.graphRunId } : { proposalId: plan.proposalId }), historyLimit: 1 });
  return ["An execution-graph decision is ready. This is bounded routing evidence; read required artifacts and verification before acceptance.",
    JSON.stringify(graphDecisionView(inspection, flags)), graphExperimentGuidance(flags, "adjudication"),
    leaderProcedurePointer("adjudication")].join("\n\n");
}
