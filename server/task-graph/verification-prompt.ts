import { graphExperimentGuidance } from "../../shared/task-graph-experiments.ts";
import { renderExperimentalAssignment, renderScopedContext, verificationCompletionGuidance, type ScopedContext } from "./node-prompt.ts";
import type { GraphRevisionInput } from "../../shared/task-graph-contracts.ts";
import { safeArtifactReference } from "./artifact-access.ts";
type Row = Record<string, unknown>;

export function renderVerificationPrompt(node:GraphRevisionInput["nodes"][number],producer:Row,
  artifacts:Row[],sourceSnapshotId:string,revision:GraphRevisionInput,context:ScopedContext[]):string {
  return [
    "Independently verify an immutable task-graph output. Do not trust or reproduce the producer's reasoning.",
    `Node: ${node.title} (${node.id})`,`Producer attempt: ${String(producer.id)}`,
    `Source snapshot: ${sourceSnapshotId}`,
    `Mission: ${revision.objective}\nObjective: ${node.objective}`,
    `Relevant constraints: ${JSON.stringify([...revision.constraints,...node.constraints])}\nNon-goals: ${JSON.stringify(revision.nonGoals)}`,
    "Verification is read-only. Producer write ownership does not authorize verifier writes.",
    graphExperimentGuidance(revision.taskGraphExperiments, "verifier"),
    renderExperimentalAssignment(revision, node),
    renderScopedContext(context.filter(source=>!source.sourceId.startsWith("skill:"))),
    `Acceptance criteria:\n${node.acceptanceCriteria.map(value=>`- ${value}`).join("\n")||"- No additional criteria"}`,
    `Artifacts:\n${artifacts.map(row=>`- ${JSON.stringify(safeArtifactReference(row))}`).join("\n")}`,
    "Read artifact content only through mcp__task-graph__read_input_artifact using the listed artifactId.",
    verificationCompletionGuidance(),
  ].join("\n\n");
}
