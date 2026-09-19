import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface NativeTool {
  name: string;
  parameters: unknown;
  execute: (id: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;
}
const extensionUrl = new URL("./swarm-tools-extension.mjs", import.meta.url).href;
const register = (await import(extensionUrl)).default as (api: { registerTool: (tool: NativeTool) => void }) => void;
const fetchMock = vi.fn<typeof fetch>();
let directory: string;
let tool: NativeTool;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bridge-test-"));
  const filename = path.join(directory, "tools.json");
  fs.writeFileSync(filename, JSON.stringify([{ name: "mcp__audit__write", label: "Write", sourceName: "write",
    description: "Write scoped artifact", inputSchema: { type: "object", properties: { value: { type: "string" } } },
    url: "http://127.0.0.1:1234/mcp/session/audit" }]));
  vi.stubEnv("SWARMCREWS_PI_TOOLS_FILE", filename);
  vi.stubEnv("SWARMCREWS_PI_TOOL_TOKEN", "fixture-token");
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  register({ registerTool: value => { tool = value; } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); fs.rmSync(directory, { recursive: true, force: true }); });

describe("Pi native tool bridge", () => {
  it("preserves schema, scoped bearer authentication, arguments, and content", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: "call", result: {
      content: [{ type: "text", text: "Written" }],
    } })));
    const signal = new AbortController().signal;
    expect(tool.name).toBe("mcp__audit__write");
    expect(tool.parameters).toMatchObject({ type: "object", properties: { value: { type: "string" } } });
    expect(await tool.execute("call", { value: "test" }, signal))
      .toEqual({ content: [{ type: "text", text: "Written" }], details: {} });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:1234/mcp/session/audit");
    expect(request?.headers).toMatchObject({ Authorization: "Bearer fixture-token" });
    expect(JSON.parse(String(request?.body))).toEqual({ jsonrpc: "2.0", id: "call", method: "tools/call",
      params: { name: "write", arguments: { value: "test" } } });
  });

  it.each([
    { jsonrpc: "2.0", id: "call", error: { message: "Permission denied" } },
    { jsonrpc: "2.0", id: "call", result: { isError: true, content: [{ type: "text", text: "Permission denied" }] } },
  ])("surfaces remote errors", async body => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(tool.execute("call", {})).rejects.toThrow("Permission denied");
  });

  it.each([{}, { jsonrpc: "2.0", id: "other", result: { content: [] } },
    { jsonrpc: "2.0", id: "call", result: {} }])("does not report malformed responses as success", async body => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
    await expect(tool.execute("call", {})).rejects.toThrow();
  });

  it("propagates cancellation to the HTTP request", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url, options) => {
      controller.abort();
      options?.signal?.throwIfAborted();
      return new Response();
    });
    await expect(tool.execute("call", {}, controller.signal)).rejects.toThrow();
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it("does not suggest replaying a mutation after an HTTP failure", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await expect(tool.execute("call", {})).rejects.toThrow("Swarmcrews tool connection failed (500)");
    await expect(tool.execute("call", {})).rejects.not.toThrow("Retry the task");
  });
});
