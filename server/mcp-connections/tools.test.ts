import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolResult, AgentTypeContext } from "../agents/types.ts";
import type { McpHttpEntry, McpServerEntry } from "../../shared/mcp-servers/types.ts";
import { CONNECTION_MCP_TOOLS, SECRET_MASK } from "../../shared/mcp-servers/connections.ts";
import { listMcpServers, mcpServersFilePath } from "../mcp-server-store.ts";
import { createMcpFixtureFetch } from "../../tests/fixtures/mcp/http-fixture.ts";
import { createConnectionConfigurationTools, createConnectionTools, installConnectionTools } from "./tools.ts";
import { connectionStatus, invalidateConnection, invokeConnection } from "./runtime.ts";

let project: string;
const entry = (): McpHttpEntry => ({ id: "fixture", name: "Fixture", transport: "http", url: "https://fixture.example/mcp" });
beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-tools-"));
  vi.stubGlobal("fetch", vi.fn(createMcpFixtureFetch()));
});
afterEach(async () => {
  await invalidateConnection(project, "fixture");
  fs.rmSync(project, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
const call = (name: string, input: unknown, signal?: AbortSignal) =>
  createConnectionConfigurationTools(project, signal).find(tool => tool.name === name)!.handler(input);

describe("Leader connection configuration", () => {
  it.each([true, false])("registers exact role and plan-mode inventories (Leader=%s)", async canConfigure => {
    for (const inspectionOnly of [true, false]) {
      const result: AgentToolResult = { toolGroups: {}, mcpToolNames: [] };
      const cleanup = installConnectionTools({ sessionKey: "test", cwd: "/unrelated", worktreeInfo: { projectPath: project } } as AgentTypeContext,
        result, new AbortController().signal, inspectionOnly, canConfigure);
      try {
        expect(result.mcpToolNames).toEqual([...CONNECTION_MCP_TOOLS,
          ...(canConfigure ? ["mcp__connections__get_connection_configuration"] : []),
          ...(canConfigure && !inspectionOnly ? ["mcp__connections__save_connection"] : []),
        ]);
        expect(result.toolGroups["connections"]!.map(tool => `mcp__connections__${tool.name}`)).toEqual(result.mcpToolNames);
        if (canConfigure && !inspectionOnly) {
          await result.toolGroups["connections"]!.find(tool => tool.name === "save_connection")!.handler({ entry: entry() });
          expect(listMcpServers(project).entries).toEqual([entry()]);
        }
      } finally { await cleanup(); }
    }
  });

  it.each([
    { ...entry(), transport: "http", headers: { Authorization: "private-token" }, oauth: { clientId: "client", clientSecret: "private-secret" } },
    { id: "fixture", name: "SSE", transport: "sse", url: "https://fixture.example/sse", headers: { Authorization: "private-token" } },
    { id: "fixture", name: "Local", transport: "stdio", command: "node", args: ["server.js"], env: { API_KEY: "private-token" } },
  ] satisfies McpServerEntry[])("saves and edits $transport with masked credentials without launching it", async original => {
    const saved = await call("save_connection", { entry: original });
    expect(saved.isError).not.toBe(true);
    expect(listMcpServers(project).entries).toEqual([original]);
    expect(JSON.stringify(saved)).not.toContain("private-");
    const read = await call("get_connection_configuration", { connectionId: "fixture" });
    expect(JSON.stringify(read)).not.toContain("private-");
    const masked = JSON.parse(read.content[0]!.text);
    expect(JSON.stringify(masked)).toContain(SECRET_MASK);
    const updated = await call("save_connection", { entry: { ...masked, name: "Updated", enabled: false, allowedTools: [] } });
    expect(updated.isError).not.toBe(true);
    expect(listMcpServers(project).entries).toEqual([{ ...original, name: "Updated", enabled: false, allowedTools: [] }]);
    expect((await call("get_connection_configuration", { connectionId: "fixture" })).isError).not.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["inspect_connection", "call_tool", "read_resource", "get_prompt"])("%s reports safe access errors without contacting unavailable connections", async name => {
    const tool = createConnectionTools(project, "access-test").find(tool => tool.name === name)!;
    const input = { connectionId: "fixture", name: "echo", arguments: {} };
    for (const [settings, message] of [
      [{ enabled: false }, "disabled"],
      [{ selfServe: false }, "not available to this run"],
    ] as const) {
      await call("save_connection", { entry: { ...entry(), ...settings, headers: { Authorization: "fixture-secret" } } });
      const result = await tool.handler(input);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain(message);
      expect(JSON.stringify(result)).not.toContain("fixture-secret");
      expect(JSON.stringify(result)).not.toContain("fixture.example");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("invalidates live sessions and immediately applies tool restrictions", async () => {
    await call("save_connection", { entry: entry() });
    const invoke = () => invokeConnection(project, "fixture", "config-test", "tool", "echo", { message: "hello" }) as Promise<{ structuredContent: { session: string } }>;
    const first = await invoke();
    await call("save_connection", { entry: { ...entry(), allowedTools: [] } });
    expect(connectionStatus(project, entry()).state).toBe("untested");
    await expect(invoke()).rejects.toThrow("not enabled");
    await call("save_connection", { entry: entry() });
    expect((await invoke()).structuredContent.session).not.toBe(first.structuredContent.session);
  });

  it("preserves saved configuration on invalid input or cancellation and does not echo secrets", async () => {
    await call("save_connection", { entry: entry() });
    const original = fs.readFileSync(mcpServersFilePath(project), "utf8");
    for (const invalid of [
      { ...entry(), url: "http://remote.example/private-secret" },
      { ...entry(), id: "../private-secret" },
      { ...entry(), headers: { Authorization: SECRET_MASK } },
      { ...entry(), headers: { Authorization: "private-secret\ninvalid" } },
    ]) {
      const result = await call("save_connection", { entry: invalid });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private-secret");
    }
    const controller = new AbortController(); controller.abort();
    expect((await call("save_connection", { entry: { ...entry(), name: "Cancelled" } }, controller.signal)).isError).toBe(true);
    expect(fs.readFileSync(mcpServersFilePath(project), "utf8")).toBe(original);
    expect((await call("get_connection_configuration", { connectionId: "missing" })).isError).toBe(true);
  });
});
