import { describe, it, expect, vi } from "vitest";
import { z } from "zod/v4";
import * as sdk from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { wrapTools } from "./tools.ts";
import type { NormalizedToolDef } from "../types.ts";

describe("wrapTools", () => {
  it.each([0, 1, 3])("registers exactly %i tools and forwards their schemas and handlers", async (count) => {
    const schema = z.object({ taskId: z.string(), title: z.string(), priority: z.enum(["low", "medium", "high"]) });
    const defs: NormalizedToolDef[] = Array.from({ length: count }, (_, index) => ({
      name: `tool_${index}`, description: `Tool ${index} description`, inputSchema: schema,
      handler: vi.fn(async () => ({ content: [{ type: "text" as const, text: `result_${index}` }] })),
    }));
    const server = wrapTools("test-server", defs, sdk);
    expect(server).toMatchObject({ type: "sdk", name: "test-server" });
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(a); await client.connect(b);
    try {
      // An empty server need not advertise tools capability.
      if (count) {
        const { tools } = await client.listTools();
        expect(tools.map(tool => tool.name)).toEqual(defs.map(def => def.name));
        expect(tools[0]?.inputSchema).toMatchObject({ type: "object", required: ["taskId", "title", "priority"] });
      }
      for (const [index, def] of defs.entries()) {
        const input = { taskId: `task_${index}`, title: "Example", priority: "high" };
        expect(await client.callTool({ name: def.name, arguments: input })).toEqual({
          content: [{ type: "text", text: `result_${index}` }],
        });
        expect(def.handler).toHaveBeenCalledExactlyOnceWith(input);
      }
    } finally { await client.close(); await server.instance.close(); }
  });

  it.each([["bad_tool", z.string()], ["number_tool", z.number()]])(
    "rejects non-object schema for %s with an actionable diagnostic", (name, inputSchema) => {
      const def: NormalizedToolDef = { name, description: "Invalid schema", inputSchema, handler: async () => ({ content: [] }) };
      expect(() => wrapTools("s", [def], sdk)).toThrow(new RegExp(`${name}.*ZodObject.*\\.shape`));
    });
  it.each([
    z.object({ value: z.string().transform(value => value + "!") }),
    z.object({ value: z.string().refine(async () => true) }),
  ])("parses inputs once using the SDK's async validation", async inputSchema => {
    const handler = vi.fn(async (input: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(input) }] }));
    const def = { name: "parse", description: "Parse", inputSchema, handler };
    const expected = await inputSchema.parseAsync({ value: "a" });
    const server = wrapTools("test", [def], sdk);
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(a); await client.connect(b);
    try {
      const result = await client.callTool({ name: "parse", arguments: { value: "a" } });
      expect(result.isError).not.toBe(true);
      expect(handler).toHaveBeenCalledExactlyOnceWith(expected);
    } finally { await client.close(); await server.instance.close(); }
  });

  it("rejects unsupported output roots before registering any tools", () => {
    const handler = vi.fn(async () => ({ content: [] }));
    const def = { name: "record", description: "Record", inputSchema: z.object({}),
      outputSchema: z.record(z.string(), z.string()), handler } as unknown as NormalizedToolDef;
    expect(() => wrapTools("test", [def], sdk)).toThrow(/record.*outputSchema.*ZodObject/);
    expect(handler).not.toHaveBeenCalled();
  });

});
