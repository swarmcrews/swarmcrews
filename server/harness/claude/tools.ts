/** Thin SDK MCP transport adapter; contracts and execution stay shared. */
import type { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { NormalizedToolDef } from "../types.ts";
import { invokeValidatedTool, toolDescriptor } from "../tool-contract.ts";

export type McpServerInstance = ReturnType<typeof createSdkMcpServer>;

export function wrapTools(
  serverName: string,
  defs: NormalizedToolDef[],
  sdk: Pick<typeof import("@anthropic-ai/claude-agent-sdk"), "createSdkMcpServer">,
): McpServerInstance {
  const descriptors = defs.map(def => {
    if (!("shape" in def.inputSchema)) {
      throw new Error(`Tool "${def.name}": inputSchema must be a ZodObject (needs a .shape property).`);
    }
    return toolDescriptor(def); // Preflight the complete inventory before publishing.
  });
  const server = sdk.createSdkMcpServer({ name: serverName });
  const registered = defs.map(def => {
    // SDK tool() omits outputSchema; public registration supports both schemas.
    return server.instance.registerTool(def.name, {
      description: def.description,
      inputSchema: def.inputSchema,
      ...(def.outputSchema ? { outputSchema: def.outputSchema } : {}),
      ...(def.annotations ? { annotations: def.annotations } : {}),
    }, async args => ({ ...await invokeValidatedTool(def, args) }));
  });
  // Public discovery API avoids the SDK's separate Zod converter, which can
  // disagree on records/recursive JSON. SDK call handling still owns input
  // parsing and enabled checks. Inventory is fixed per invocation.
  if (defs.length) server.instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: descriptors.filter((_descriptor, index) => registered[index]!.enabled),
  }));
  return server;
}
