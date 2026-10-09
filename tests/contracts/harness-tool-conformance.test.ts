import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import Ajv, { type AnySchema } from "ajv";
import { toolDescriptor } from "../../server/harness/tool-contract.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadSdk } from "../../server/harness/claude/sdk.ts";
import { wrapTools } from "../../server/harness/claude/tools.ts";
import { copilotTools } from "../../server/harness/copilot/tools.ts";
import { dispatchMethod } from "../../server/mcp-bridge/dispatch.ts";
import type { NormalizedToolDef, NormalizedToolResult } from "../../server/harness/types.ts";

const outputSchema = z.object({ cursor: z.string().nullable(), items: z.array(z.object({ id: z.number() })), error: z.string().optional() });
const data = { cursor: null, items: [{ id: 1 }] };
const success: NormalizedToolResult = { content: [{ type: "text", text: "One item" }], structuredContent: data };
const makeDef = (handler: NormalizedToolDef["handler"]): NormalizedToolDef => ({
  name: "lookup", description: "Lookup", inputSchema: z.object({ limit: z.number().default(1) }),
  outputSchema, annotations: { readOnlyHint: true, idempotentHint: true }, handler,
});
type Adapter = { call(input: unknown): Promise<NormalizedToolResult>; close(): Promise<void> };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function adapter(kind: string, def: NormalizedToolDef): Promise<Adapter> {
  if (kind === "claude") {
    const server = wrapTools("fixture", [def], await loadSdk());
    const client = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    cleanups.push(async () => { await client.close(); await server.instance.close(); });
    await server.instance.connect(a); await client.connect(b);
    const catalog = await client.listTools();
    expect(catalog.tools[0]).toMatchObject({ outputSchema: { type: "object" }, annotations: { readOnlyHint: true } });
    return { call: async input => await client.callTool({ name: def.name, arguments: input as Record<string, unknown> }) as NormalizedToolResult,
      close: async () => { await client.close(); await server.instance.close(); } };
  }
  if (kind === "copilot") {
    const [tool] = copilotTools({ fixture: [def] }, ["mcp__fixture__lookup"]);
    expect(copilotTools({ fixture: [def] }, [])).toEqual([]);
    const validate = new Ajv({ strict: false }).compile(tool!.parameters as AnySchema);
    return { call: async input => {
      if (!validate(input)) return { content: [{ type: "text", text: "Invalid native input" }], isError: true };
      const native = await tool!.handler!(input, {} as never) as { textResultForLlm: string; resultType: string };
      let result: NormalizedToolResult;
      try { result = JSON.parse(native.textResultForLlm); }
      catch { result = { content: [{ type: "text", text: native.textResultForLlm }] }; }
      return { ...result, ...(native.resultType === "failure" ? { isError: true } : {}) };
    }, close: async () => {} };
  }
  const request = async (input: unknown) => {
    const response = await dispatchMethod({ jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: def.name, arguments: input } }, [def]);
    return response.result as NormalizedToolResult;
  };
  if (kind === "pi") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-conformance-"));
    cleanups.push(async () => { fs.rmSync(dir, { recursive: true, force: true }); });
    const file = path.join(dir, "tools.json");
    fs.writeFileSync(file, JSON.stringify([{ ...toolDescriptor(def), name: "mcp__fixture__lookup", label: "lookup", sourceName: "lookup",
      url: "https://bridge.test/fixture" }]));
    vi.stubEnv("SWARMCREWS_PI_TOOLS_FILE", file); vi.stubEnv("SWARMCREWS_PI_TOOL_TOKEN", "test-token");
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
      const body = JSON.parse(String(init.body));
      return Response.json({ jsonrpc: "2.0", id: body.id, result: await request(body.params.arguments) });
    });
    const extension = await import(/* @vite-ignore */ new URL("../../server/harness/pi/swarm-tools-extension.mjs", import.meta.url).href);
    let registered: { parameters: AnySchema; outputSchema?: unknown; annotations?: unknown; execute(id: string, input: unknown): Promise<NormalizedToolResult> };
    extension.default({ registerTool: (tool: typeof registered) => { registered = tool; } });
    expect(registered!.outputSchema).toMatchObject({ type: "object" });
    expect(registered!.annotations).toMatchObject({ readOnlyHint: true });
    // Validate the advertised schema before execution, as Pi does. This is a
    // portable JSON-schema boundary test, not a live Pi/provider integration.
    const validate = new Ajv({ strict: false }).compile(registered!.parameters);
    return { call: async input => {
      if (!validate(input)) return { content: [{ type: "text", text: "Invalid native input" }], isError: true };
      const native = await registered!.execute("call", input);
      if (native.structuredContent === undefined) return native;
      // Pi preserves direct data and emits an explicit JSON fallback for model/history.
      const presented = JSON.parse(native.content[0]!.text) as NormalizedToolResult;
      expect(presented.structuredContent).toEqual(native.structuredContent);
      return presented;
    }, close: async () => { fs.rmSync(dir, { recursive: true, force: true }); } };
  }
  // Both Codex and OpenCode use this exact MCP dispatcher after run filtering.
  const list = await dispatchMethod({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [def]);
  expect(list.result).toMatchObject({ tools: [{ outputSchema: { type: "object" } }] });
  const denied = await dispatchMethod({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "forbidden" } }, [def]);
  expect(denied.error?.code).toBe(-32601);
  return { call: request, close: async () => {} };
}

for (const kind of ["claude", "mcp-bridge (codex/opencode)", "pi", "copilot"]) {
  describe(`${kind} shared tool semantics`, () => {
    const open = (def: NormalizedToolDef) => adapter(kind, def);
    it("preserves structured data, nulls and a separate display summary", async () => {
      const handler = vi.fn(async () => success);
      const a = await open(makeDef(handler));
      expect(await a.call({})).toMatchObject(success);
      expect(handler).toHaveBeenCalledExactlyOnceWith({ limit: 1 });
    });
    it("rejects invalid inputs without executing", async () => {
      const handler = vi.fn(async () => success);
      const a = await open(makeDef(handler));
      expect((await a.call({ limit: "bad" })).isError).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });
    it.each([{ wrong: true }, { ...data, undeclared: true }])("rejects invalid successful output %j", async structuredContent => {
      const a = await open(makeDef(async () => ({ content: [], structuredContent })));
      const result = await a.call({});
      expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
    });
    it("preserves structured failures and does not retry side effects", async () => {
      const failure = { content: [{ type: "text" as const, text: "Denied" }], structuredContent: { cursor: null, items: [], error: "Denied" }, isError: true };
      const handler = vi.fn(async () => failure);
      const a = await open(makeDef(handler));
      expect(await a.call({})).toMatchObject(failure); expect(handler).toHaveBeenCalledOnce();
    });
    it("reports cancellation exceptions as failures without retry", async () => {
      const handler = vi.fn(async () => { throw new Error("Operation aborted"); });
      const a = await open(makeDef(handler));
      const result = await a.call({});
      expect(result.isError).toBe(true); expect(result.content[0]?.text).toContain("Operation aborted");
      expect(handler).toHaveBeenCalledOnce();
    });
  });
}
