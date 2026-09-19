import { createMcpFixtureFetch } from "../../tests/fixtures/mcp/http-fixture.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createConnectionTools, installConnectionTools } from "./tools.ts";
import { inspectConnection, invokeConnection, closeConnectionScope, invalidateConnection, connectionStatus } from "./runtime.ts";
import { saveMcpServer } from "../mcp-server-store.ts";
import { redactEntry, restoreSecrets, saveCredentials, readCredentials, connectionRevision } from "./credentials.ts";
import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";

let project: string;
const scopes = ["test-a", "test-b"];
beforeEach(() => { vi.stubGlobal("fetch", createMcpFixtureFetch()); project = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-runtime-")); });
afterEach(async () => { await Promise.all(scopes.map(closeConnectionScope)); await invalidateConnection(project, "fixture"); fs.rmSync(project, { recursive: true, force: true }); vi.unstubAllGlobals(); });
const entry = (): McpServerEntry => ({ id: "fixture", name: "Fixture", transport: "http", url: "https://fixture.example/mcp" });
describe("Swarmcrews-owned MCP runtime", () => {
  it("discovers and invokes an HTTP MCP server through the exposed Swarmcrews tools", async () => {
    saveMcpServer(project, entry());
    const tools = createConnectionTools(project, scopes[0]!);
    const list = await tools.find(t => t.name === "list_connections")!.handler({});
    expect(list.content[0]!.text).toContain('"state":"untested"');
    const inspect = await tools.find(t => t.name === "inspect_connection")!.handler({ connectionId: "fixture" });
    expect(inspect.isError).not.toBe(true); expect(inspect.content[0]!.text).toContain("Echo a message");
    const call = await tools.find(t => t.name === "call_tool")!.handler({ connectionId: "fixture", name: "echo", arguments: { message: "Swarmcrews E2E" } });
    expect(call.isError).not.toBe(true);
    expect(JSON.parse(call.content[0]!.text)).toMatchObject({ content: [{ text: "Swarmcrews E2E" }], structuredContent: { session: "fixture-1" } });
    expect(connectionStatus(project, entry()).state).toBe("ready");
  });
  it("resolves an isolated child agent's catalog from the registered source project", async () => {
    saveMcpServer(project, entry());
    const result = { toolGroups: {}, mcpToolNames: [] as string[] };
    const cleanup = installConnectionTools({ sessionKey: "child", cwd: "/unrelated/worktree", parentWorktree: { projectPath: project } } as never, result as never, new AbortController().signal);
    try {
      const defs = result.toolGroups as Record<string, ReturnType<typeof createConnectionTools>>;
      expect(JSON.stringify(await defs["connections"]!.find(t => t.name === "list_connections")!.handler({}))).toContain("fixture");
      expect(result.mcpToolNames).toContain("mcp__connections__call_tool");
    } finally { await cleanup(); }
  });
  it("isolates sessions and projects and creates fresh sessions after scope closure", async () => {
    saveMcpServer(project, entry());
    const a = await invokeConnection(project, "fixture", "test-a", "tool", "echo", { message: "a" }) as { structuredContent: { session: string } };
    const b = await invokeConnection(project, "fixture", "test-b", "tool", "echo", { message: "b" }) as { structuredContent: { session: string } };
    expect(a.structuredContent.session).not.toBe(b.structuredContent.session);
    await closeConnectionScope("test-a");
    const fresh = await invokeConnection(project, "fixture", "test-a", "tool", "echo", { message: "fresh" }) as { structuredContent: { session: string } };
    expect(fresh.structuredContent.session).not.toBe(a.structuredContent.session);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-other-"));
    try { await expect(inspectConnection(other, "fixture", "test-a")).rejects.toThrow("not found"); }
    finally { fs.rmSync(other, { recursive: true, force: true }); }
  });
  it("terminates the remote MCP session when its invocation scope closes", async () => {
    const fetch = vi.fn(createMcpFixtureFetch()); vi.stubGlobal("fetch", fetch);
    saveMcpServer(project, entry());
    await inspectConnection(project, "fixture", "test-a");
    await closeConnectionScope("test-a");
    const deletion = fetch.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deletion).toBeDefined();
    expect(new Headers(deletion![1]?.headers).get("Mcp-Session-Id")).toBe("fixture-1");
  });
  it("supports resources and prompts and enforces disabled and per-tool access", async () => {
    saveMcpServer(project, { ...entry(), allowedTools: ["echo"] });
    expect(await inspectConnection(project, "fixture", "test-a")).toMatchObject({ resources: [{ uri: "fixture://readme" }], prompts: [{ name: "greeting" }] });
    expect(await invokeConnection(project, "fixture", "test-a", "resource", "fixture://readme", {})).toMatchObject({ contents: [{ text: "Fixture resource" }] });
    expect(await invokeConnection(project, "fixture", "test-a", "prompt", "greeting", { name: "User" })).toMatchObject({ messages: [{ content: { text: "Hello User" } }] });
    await expect(invokeConnection(project, "fixture", "test-a", "tool", "delete", {})).rejects.toThrow("not enabled");
    saveMcpServer(project, { ...entry(), enabled: false });
    await expect(invokeConnection(project, "fixture", "test-a", "tool", "echo", {})).rejects.toThrow("disabled");
  });
  it("does not execute tools in inspection-only runs", async () => {
    saveMcpServer(project, entry()); const tools = createConnectionTools(project, "test-a", undefined, true);
    expect((await tools.find(t => t.name === "call_tool")!.handler({ connectionId: "fixture", name: "echo", arguments: {} })).isError).toBe(true);
    expect(connectionStatus(project, entry()).state).toBe("untested");
  });
  it("bounds model results explicitly and never connects after cancellation", async () => {
    saveMcpServer(project, entry());
    const controller = new AbortController();
    const cancelled = createConnectionTools(project, "test-a", controller.signal);
    controller.abort();
    expect((await cancelled.find(t => t.name === "inspect_connection")!.handler({ connectionId: "fixture" })).isError).toBe(true);
    expect((await cancelled.find(t => t.name === "call_tool")!.handler({ connectionId: "fixture", name: "echo", arguments: {} })).isError).toBe(true);
    const tools = createConnectionTools(project, "test-a");
    const result = await tools.find(t => t.name === "call_tool")!.handler({ connectionId: "fixture", name: "echo", arguments: { message: "a".repeat(1_000_001) } });
    expect(result.isError).toBe(true); expect(result.content[0]!.text).toContain("exceeds 1 MB");
  });
  it("redacts credentials and never reuses OAuth tokens after endpoint changes", () => {
    const remote: McpServerEntry = { id: "fixture", name: "Remote", transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer secret" }, oauth: { clientSecret: "private" } };
    expect(JSON.stringify(redactEntry(remote))).not.toContain("secret");
    expect(JSON.stringify(redactEntry(remote))).not.toContain("private");
    expect(restoreSecrets(redactEntry(remote), remote)).toEqual(remote);
    saveCredentials(project, remote.id, { revision: connectionRevision(remote), redirectUrl: "http://localhost/callback", tokens: { access_token: "access", token_type: "Bearer" } });
    expect(readCredentials(project, remote)?.tokens?.access_token).toBe("access");
    expect(readCredentials(project, { ...remote, url: "https://other.example/mcp" })).toBeUndefined();
  });
});
