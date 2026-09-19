import { describe, expect, it } from "vitest";
import { compileWorkPacket } from "./compile.ts";
import { loadSystemModel } from "./load.ts";
import { renderTaskWorkPacketContextPack } from "./task-context.ts";

async function fixture() {
  const model = loadSystemModel(process.cwd()).model!;
  const { packet } = await compileWorkPacket({ model, cwd: process.cwd(), headSha: "task-context",
    mode: "advisory", userRequest: "Canvas and scheduler", normalizedGoal: "Canvas and scheduler",
    matchedCandidates: ["capability.spatial_canvas", "capability.execution_graph_runtime"].map(id =>
      ({ id, type: "capability" as const, score: 10, reasons: [] })), matchConfidence: "high",
    taskFiles: ["src/CanvasMiniMap.tsx", "server/task-graph/scheduler.ts"],
    timestampFn: async () => ({ modelTouchedAt: 20, codeTouchedAt: 10 }), now: 30 });
  return { model, packet };
}

describe("task Work Packet projection", () => {
  it("separates canvas and scheduler guidance and leaves the original packet unchanged", async () => {
    const { model, packet } = await fixture();
    const before = structuredClone(packet);
    const canvas = renderTaskWorkPacketContextPack(model, packet, { objective: "Canvas only", files: ["src/CanvasMiniMap.tsx"] });
    const graph = renderTaskWorkPacketContextPack(model, packet, { objective: "Scheduler only", files: ["server/task-graph/scheduler.ts"] });
    expect(canvas).toContain("Task: Canvas only");
    expect(canvas).toContain("Capability capability.spatial_canvas:");
    expect(canvas).not.toContain("Capability capability.execution_graph_runtime:");
    expect(canvas).not.toContain("Constraint constraint.execution_graph_authority:");
    expect(graph).toContain("Capability capability.execution_graph_runtime:");
    expect(graph).toContain("Constraint constraint.execution_graph_authority:");
    expect(graph).not.toContain("Capability capability.spatial_canvas:");
    expect(graph).not.toContain("src/CanvasMiniMap.tsx");
    expect(packet).toEqual(before);
  });

  it("retains global safeguards even for an unmodeled path and does not leak sibling instructions", async () => {
    const { model, packet } = await fixture();
    const global = { ...model.constraints[0]!, id: "constraint.global_test", scope: "global" as const,
      statement: "GLOBAL_GUARD", agentInstruction: "GLOBAL_INSTRUCTION", guards: [],
      appliesTo: { capabilities: [], flows: [], surfaces: [], files: [] } };
    model.constraints.push(global); model.objectsById.set(global.id, global);
    const context = renderTaskWorkPacketContextPack(model, packet, { objective: "Readme", files: ["README.md"] });
    expect(context).toContain("GLOBAL_INSTRUCTION");
    expect(context).not.toContain("Capability capability.");
    expect(context).not.toContain(model.constraints.find(item => item.id === "constraint.execution_graph_authority")!.agentInstruction!);
  });

  it("accepts directories and explicit selections, with conservative fallback when hints are absent", async () => {
    const { model, packet } = await fixture();
    const folder = renderTaskWorkPacketContextPack(model, packet, { objective: "Graph", files: ["server/task-graph/"] });
    expect(folder).toContain("Capability capability.execution_graph_runtime:");
    expect(folder).not.toContain("Capability capability.spatial_canvas:");
    const explicit = renderTaskWorkPacketContextPack(model, packet, { objective: "Canvas review", files: [], objectIds: ["capability.spatial_canvas"] });
    expect(explicit).toContain("Capability capability.spatial_canvas:");
    expect(explicit).not.toContain("Capability capability.execution_graph_runtime:");
    const shared = renderTaskWorkPacketContextPack(model, packet, { objective: "Review all", files: [] });
    expect(shared).toContain("Capability capability.spatial_canvas:");
    expect(shared).toContain("Capability capability.execution_graph_runtime:");
    expect(() => renderTaskWorkPacketContextPack(model, packet, { objective: "Missing", files: [], objectIds: ["capability.missing"] })).toThrow(/Amend the packet/);
  });

  it("filters object-bound evidence, signals, and freshness while retaining shared observations", async () => {
    const { model, packet } = await fixture();
    packet.evidenceLedger = [
      { id: "e.graph", kind: "observation", summary: "GRAPH_EVIDENCE", objectIds: ["capability.execution_graph_runtime"], criterionIds: [], evidenceRefs: [], provenance: "leader_observed", createdAt: 1 },
      { id: "e.shared", kind: "observation", summary: "SHARED_EVIDENCE", objectIds: [], criterionIds: [], evidenceRefs: [], provenance: "leader_observed", createdAt: 1 },
    ];
    packet.freshness.requiredVerifications = [{ kind: "freshness", target: "capability.execution_graph_runtime", reason: "GRAPH_FRESHNESS", status: "not_run" }];
    const canvas = renderTaskWorkPacketContextPack(model, packet, { objective: "Canvas", files: ["src/CanvasMiniMap.tsx"] });
    expect(canvas).toContain("SHARED_EVIDENCE");
    expect(canvas).not.toContain("GRAPH_EVIDENCE");
    expect(canvas).not.toContain("GRAPH_FRESHNESS");
  });
});
