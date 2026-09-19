import { z } from "zod/v4";
import type { Tool } from "@github/copilot-sdk";
import type { NormalizedToolDef } from "../types.ts";

/** Expose only this invocation's allowed tools, preserving canonical names. */
export function copilotTools(groups: Record<string, NormalizedToolDef[]>, allowed: readonly string[]): Tool[] {
  const allowlist = new Set(allowed);
  return Object.entries(groups).flatMap(([server, definitions]) => definitions.flatMap((definition) => {
    const name = `mcp__${server}__${definition.name}`;
    if (!allowlist.has(name)) return [];
    return [{
      name, description: definition.description,
      parameters: z.toJSONSchema(definition.inputSchema, { unrepresentable: "any" }),
      handler: async (input: unknown) => {
        try {
          const result = await definition.handler(definition.inputSchema.parse(input));
          return { textResultForLlm: result.content.map((block) => block.text).join("\n"),
            resultType: result.isError ? "failure" as const : "success" as const };
        } catch (error) {
          return { textResultForLlm: error instanceof Error ? error.message : "Tool failed", resultType: "failure" as const };
        }
      },
    }];
  }));
}
