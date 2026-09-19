import { readFileSync } from "node:fs";

/** Pi-native tools backed by Swarmcrews. No external MCP initialization here. */
export default function registerSwarmcrewsTools(pi) {
  const config = JSON.parse(readFileSync(process.env.SWARMCREWS_PI_TOOLS_FILE, "utf8"));
  const bearer = process.env.SWARMCREWS_PI_TOOL_TOKEN;
  for (const tool of config) {
    pi.registerTool({
      name: tool.name, label: tool.label, description: tool.description, parameters: tool.inputSchema,
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
        if (body.result?.isError) throw new Error(body.result.content?.map(block => block.text || "").join("\n") || "Swarmcrews tool failed");
        return { content: body.result.content, details: {} };
      },
    });
  }
}
