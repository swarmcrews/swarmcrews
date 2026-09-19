import { describe, expect, it } from "vitest";
import { compileWorkPacket, ContextPackBudgetError, renderWorkPacketContextPack } from "./compile.ts";
import { loadSystemModel } from "./load.ts";

async function fixture() {
  const model = loadSystemModel(process.cwd()).model!;
  const result = await compileWorkPacket({ model, cwd: process.cwd(), headSha: "context-pressure",
    mode: "advisory", userRequest: "Graph scheduler", normalizedGoal: "Graph scheduler",
    matchedCandidates: [{ id: "capability.execution_graph_runtime", type: "capability", score: 10, reasons: [] }],
    matchConfidence: "high", taskFiles: ["server/task-graph/scheduler.ts"],
    acceptanceCriteria: Array.from({ length: 60 }, (_, i) => `Criterion ${i}: verify scheduler behavior with evidence.`),
    timestampFn: async () => ({ modelTouchedAt: 20, codeTouchedAt: 10 }), now: 30 });
  return { model, ...result };
}

describe("mandatory context under pressure", () => {
  it("retains every full constraint before optional signals and criteria within the authored budget", async () => {
    const { model, packet, contextPack } = await fixture();
    for (const id of packet.scope.constraints) {
      const constraint = model.constraints.find(item => item.id === id)!;
      expect(contextPack).toContain(constraint.statement);
      expect(contextPack).toContain(constraint.agentInstruction!);
    }
    expect(contextPack).toContain("omitted");
    expect(contextPack).not.toContain("query_system_model");
    expect(Math.ceil(contextPack.length / 4)).toBeLessThanOrEqual(model.policies.contextBudgets.minionContextPack);
  });

  it("does not apply the summary cap to mandatory text or freshness instructions", async () => {
    const { model, packet } = await fixture();
    model.policies.contextBudgets.perObjectSummary = 5;
    packet.agentInstructions.push("Inspect the entire safety-critical implementation before modifying scheduler behavior.");
    packet.freshness.requiredVerifications.push({ kind: "freshness", target: "capability.execution_graph_runtime",
      reason: "Verify scheduler behavior against the current implementation and report the result.", status: "not_run" });
    const context = renderWorkPacketContextPack(model, packet);
    expect(context).toContain(packet.agentInstructions.at(-1)!);
    expect(context).toContain(packet.freshness.requiredVerifications.at(-1)!.reason);
    expect(context).toContain(model.constraints.find(item => item.id === packet.scope.constraints[0])!.statement);
  });

  it("fails explicitly if required guidance alone exceeds the budget", async () => {
    const { model, packet } = await fixture();
    model.policies.contextBudgets.minionContextPack = 45;
    expect(() => renderWorkPacketContextPack(model, packet)).toThrow(ContextPackBudgetError);
    expect(() => renderWorkPacketContextPack(model, packet)).toThrow(/Narrow the Work Packet scope/);
  });
});
