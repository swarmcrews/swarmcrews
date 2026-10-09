import type { Tool } from "@github/copilot-sdk";
import type { NormalizedToolDef } from "../types.ts";
import { invokeTool, toolDescriptor } from "../tool-contract.ts";
import { toolResultText } from "../tool-result.ts";

/** Expose only this invocation's allowed tools, preserving canonical names. */
export function copilotTools(groups: Record<string, NormalizedToolDef[]>, allowed: readonly string[]): Tool[] {
  const allowlist = new Set(allowed);
  return Object.entries(groups).flatMap(([server, definitions]) => definitions.flatMap((definition) => {
    const name = `mcp__${server}__${definition.name}`;
    if (!allowlist.has(name)) return [];
    return [{
      name, description: definition.description,
      parameters: toolDescriptor(definition).inputSchema,
      handler: async (input: unknown) => {
        const result = await invokeTool(definition, input);
        // Copilot's ToolResultObject has no structuredContent channel. Keep a
        // lossless JSON envelope rather than silently dropping machine data.
        return { textResultForLlm: toolResultText(result),
          resultType: result.isError ? "failure" as const : "success" as const };
      },
    }];
  }));
}
