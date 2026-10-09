import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sdk from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { wrapTools } from "./tools.ts";
import { toolDescriptor } from "../tool-contract.ts";
import { structuredResult } from "../tool-result.ts";
import type { NormalizedToolDef } from "../types.ts";
import { createConnectionTools, createConnectionConfigurationTools } from "../../mcp-connections/tools.ts";

async function withClient(defs: NormalizedToolDef[], check: (client: Client) => Promise<void>) {
  const server = wrapTools("test", defs, sdk);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try { await server.instance.connect(a); await client.connect(b); await check(client); }
  finally { await client.close(); await server.instance.close(); }
}

describe("Claude SDK discovery uses the shared schema contract", () => {
  it.each([
    [z.object({ entries: z.record(z.string(), z.string().nullable()) }), { entries: { cursor: null } }],
    [z.object({ result: z.json() }), { result: [null, { nested: ["value", null] }] }],
  ])("lists and calls nested output schemas through the actual SDK", async (outputSchema, data) => {
    const def: NormalizedToolDef = { name: "lookup", description: "Lookup",
      inputSchema: z.object({ args: z.record(z.string(), z.unknown()).default({}) }), outputSchema,
      handler: async () => structuredResult(data) };
    await withClient([def], async client => {
      const { tools } = await client.listTools();
      expect(tools[0]).toEqual(toolDescriptor(def));
      expect(await client.callTool({ name: "lookup", arguments: {} })).toMatchObject({ structuredContent: data });
    });
  });
  it("discovers the production Connections inventory and calls list_connections", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "claude-connection-schema-"));
    try {
      const defs = [...createConnectionTools(project, "schema-test"), ...createConnectionConfigurationTools(project)];
      await withClient(defs, async client => {
        const { tools } = await client.listTools();
        expect(tools).toEqual(defs.map(toolDescriptor));
        expect(await client.callTool({ name: "list_connections", arguments: {} })).toMatchObject({ structuredContent: { result: [] } });
        expect((await client.callTool({ name: "not_registered", arguments: {} })).isError).toBe(true);
      });
    } finally { fs.rmSync(project, { recursive: true, force: true }); }
  });
});
