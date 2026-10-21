import { describe, expect, it } from "vitest";
import { createLeaderProcedureTools } from "../../server/leader-procedure-tools.ts";
import { LEADER_PROCEDURE_IDS, getLeaderProcedure } from "../../shared/leader-procedures.ts";
import { composeLeaderPrompt } from "../../shared/leader-prompt.ts";

describe("callable lifecycle procedures", () => {
  it("discovers and retrieves every phase without injecting bodies into launch", async () => {
    const [tool] = createLeaderProcedureTools();
    const index = await tool!.handler({});
    const prompt = composeLeaderPrompt({ builtInTools: [], registeredToolNames: [tool!.name] });
    for (const id of LEADER_PROCEDURE_IDS) {
      expect(JSON.stringify(index)).toContain(id);
      const response = await tool!.handler({ id });
      const procedure = getLeaderProcedure(id)!;
      const block = response.content.find(item => item.type === "text")!;
      expect(JSON.parse(block.text).body).toBe(procedure.body);
      expect(prompt).not.toContain(procedure.body);
    }
    expect(prompt).toContain('load_procedure');
    expect(prompt).toContain('reorientation');
    expect(tool!.description).toContain('reorientation');
    expect(await tool!.handler({ id: "unknown" })).toMatchObject({ isError: true });
  });

  it("provides a bounded OODA loop without granting mutation or approval authority", async () => {
    const [tool] = createLeaderProcedureTools();
    const response = await tool!.handler({ id: "reorientation" });
    expect(response.isError).not.toBe(true);
    const text = response.content.find(item => item.type === "text")!;
    const { body } = JSON.parse(text.text);
    for (const phase of ["Observe", "Orient", "Decide", "Act"]) expect(body).toContain(phase);
    for (const control of ["get_graph_plan", "cancel_graph_run", "submit_graph_plan",
      "baseProposalRevision", "evidenceRefs", "stopCondition", "wait_and_continue"])
      expect(body).toContain(control);
    expect(body).toContain('any_terminal');
    expect(body).toMatch(/approval/i);
    expect(body).toMatch(/independent verification/i);
    expect(body).toMatch(/historical.*read-only/i);
    expect(body).toMatch(/new evidence/i);
    expect(body).toMatch(/never.*automatically cancel/i);
  });
});
