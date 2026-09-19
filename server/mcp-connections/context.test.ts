import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveMcpServer } from "../mcp-server-store.ts";
import { buildConnectionContext } from "./context.ts";
import { createConnectionTools } from "./tools.ts";
import { closeConnectionScope, invalidateConnection } from "./runtime.ts";
import { createMcpFixtureFetch } from "../../tests/fixtures/mcp/http-fixture.ts";

let project: string;
const entry = { id: "fixture", name: "Selected Docs", transport: "http" as const, url: "https://fixture.example/mcp", headers: { Authorization: "secret-token" }, selfServe: false };
beforeEach(() => { project = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-context-")); vi.stubGlobal("fetch", vi.fn(createMcpFixtureFetch())); });
afterEach(async () => { await closeConnectionScope("context-test"); await invalidateConnection(project, "fixture"); fs.rmSync(project, { recursive: true, force: true }); vi.unstubAllGlobals(); });

describe("connection context and access", () => {
  it("separates selected context from advertisements and excludes configuration secrets", () => {
    saveMcpServer(project, entry);
    saveMcpServer(project, { ...entry, id: "advertised", name: "Discoverable Docs", selfServe: true });
    saveMcpServer(project, { ...entry, id: "hidden", name: "Hidden Docs" });
    const prompt = buildConnectionContext(project, ["fixture"]);
    expect(prompt).toContain("## Selected MCP Connections");
    expect(prompt.split("## Available MCP Connections")[0]).toContain("Selected Docs");
    expect(prompt.split("## Available MCP Connections")[1]).toContain("Discoverable Docs");
    expect(prompt).not.toMatch(/Hidden Docs|secret-token|https:/);
  });
  it("preselects defaults independently of self-serve but honors explicit deselection and disabled entries", () => {
    saveMcpServer(project, { ...entry, isDefault: true });
    expect(buildConnectionContext(project)).toContain("Selected Docs");
    expect(buildConnectionContext(project, [])).toBe("");
    saveMcpServer(project, { ...entry, isDefault: true, enabled: false });
    expect(buildConnectionContext(project, ["fixture"])).toBe("");
  });
  it("blocks all discovery and invocation paths for unselected private connections without contacting the server", async () => {
    saveMcpServer(project, entry);
    const tools = createConnectionTools(project, "context-test", undefined, false, []);
    expect(JSON.stringify(await tools.find(t => t.name === "list_connections")!.handler({}))).not.toContain("fixture");
    for (const name of ["inspect_connection", "call_tool", "read_resource", "get_prompt"]) {
      const result = await tools.find(t => t.name === name)!.handler({ connectionId: "fixture", name: "echo", arguments: {} });
      expect(result.isError).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
    const selected = createConnectionTools(project, "context-test", undefined, false, ["fixture"]);
    expect((await selected.find(t => t.name === "call_tool")!.handler({ connectionId: "fixture", name: "echo", arguments: { message: "selected" } })).isError).not.toBe(true);
    saveMcpServer(project, { ...entry, enabled: false });
    expect((await selected.find(t => t.name === "call_tool")!.handler({ connectionId: "fixture", name: "echo", arguments: {} })).isError).toBe(true);
  });
});
