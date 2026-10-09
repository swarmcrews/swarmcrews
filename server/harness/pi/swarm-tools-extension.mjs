import { readFileSync } from "node:fs";
import { toolResultText } from "../tool-result-text.mjs";

/** Pi-native tools backed by Swarmcrews. No external MCP initialization here. */
export default function registerSwarmcrewsTools(pi) {
  const config = JSON.parse(readFileSync(process.env.SWARMCREWS_PI_TOOLS_FILE, "utf8"));
  const bearer = process.env.SWARMCREWS_PI_TOOL_TOKEN;
  for (const tool of config) {
    pi.registerTool({
      name: tool.name, label: tool.label, description: tool.description, parameters: tool.inputSchema,
      ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      async execute(_id, args, signal) {
        const response = await fetch(tool.url, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: _id, method: "tools/call", params: { name: tool.sourceName, arguments: args } }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000),
        });
        if (!response.ok) throw new Error(`Swarmcrews tool connection failed (${response.status}).`);
        const body = await response.json();
        if (!body || body.jsonrpc !== "2.0" || body.id !== _id) throw new Error("Invalid Swarmcrews tool response.");
        if (body.error) throw new Error(body.error.message || "Swarmcrews tool failed");
        if (!Array.isArray(body.result?.content)) throw new Error("Invalid Swarmcrews tool result.");
        const result = body.result;
        const structured = result.structuredContent !== undefined;
        // Pi's ordinary model/history projection does not retain structuredContent.
        // Text carries the complete data; details also retain it for native replay/UI.
        // Direct callers/events still receive the original machine channel.
        return {
          content: structured ? [{ type: "text", text: toolResultText(result) }] : result.content,
          details: structured ? { structuredContent: result.structuredContent } : {},
          ...(structured ? { structuredContent: result.structuredContent } : {}),
          ...(result.isError ? { isError: true } : {}),
        };
      },
    });
  }
}
