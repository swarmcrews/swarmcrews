import { graphExperimentGuidance, type TaskGraphExperiments } from "../shared/task-graph-experiments.ts";
import { z } from "zod/v4";
import type { NormalizedToolDef } from "./harness/types.ts";
import { textResult } from "./harness/tool-result.ts";
import { getLeaderProcedure, listLeaderProcedures } from "../shared/leader-procedures.ts";

/** Harness-neutral registration: Claude SDK and Codex bridge use the same definition. */
export function createLeaderProcedureTools(experiments?: TaskGraphExperiments): NormalizedToolDef[] {
  const schema = z.object({ id: z.string().optional() }).strict();
  return [{
    name: "load_procedure",
    description: "Discover lifecycle procedures with {}. Retrieve only the current phase with {id}: graph_authoring, review_start, adjudication, cancellation_recovery, reconciliation, dialectic. Read-only guidance; does not change state, authorize actions, or bypass server policy.",
    inputSchema: schema,
    handler: async input => {
      const { id } = schema.parse(input);
      if (id === undefined) return textResult(JSON.stringify({ procedures: listLeaderProcedures() }));
      const procedure = getLeaderProcedure(id);
      if (!procedure) return { ...textResult(`Unknown procedure ${JSON.stringify(id)}; call load_procedure with {} for the index.`), isError: true };
      const guidance = graphExperimentGuidance(experiments, id);
      return textResult(JSON.stringify(guidance ? { ...procedure, body: procedure.body + "\n\n" + guidance } : procedure));
    },
  }];
}
