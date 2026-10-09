import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { dispatchMethod } from "../../server/mcp-bridge/dispatch.ts";
import { structuredResult } from "../../server/harness/tool-result.ts";
import { toolDescriptor } from "../../server/harness/tool-contract.ts";
import type { NormalizedToolDef } from "../../server/harness/types.ts";

describe("shared dispatcher with the installed MCP client", () => {
  it.each([
    [z.object({ pair: z.tuple([z.string(), z.number()]) }), { pair: ["a", 1] }],
    [z.object({ entries: z.record(z.string(), z.string().nullable()) }), { entries: { cursor: null } }],
    [z.object({ result: z.json() }), { result: [null, { nested: ["value", null] }] }],
  ])("round-trips supported object schemas through native discovery and validation", async (outputSchema, data) => {
    const def: NormalizedToolDef = { name: "lookup", description: "Lookup", inputSchema: z.object({ limit: z.number().default(1) }),
      outputSchema, handler: async () => structuredResult(data) };
    const server = new Server({ name: "test", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [toolDescriptor(def)] }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const response = await dispatchMethod({ jsonrpc: "2.0", id: 1, method: "tools/call", params: request.params }, [def]);
      return response.result as Awaited<ReturnType<typeof def.handler>>;
    });
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a); await client.connect(b);
      const { tools } = await client.listTools();
      expect(tools[0]?.inputSchema.required ?? []).not.toContain("limit");
      expect(tools[0]?.outputSchema?.["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
      expect(await client.callTool({ name: def.name, arguments: {} })).toMatchObject({ structuredContent: data });
    } finally { await client.close(); await server.close(); }
  });
});
