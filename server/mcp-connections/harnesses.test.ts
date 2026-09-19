import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessStartOptions, NormalizedToolDef } from "../harness/types.ts";
import { createConnectionTools } from "./tools.ts";
import { closeConnectionScope } from "./runtime.ts";
import { saveMcpServer } from "../mcp-server-store.ts";
import { createMcpFixtureFetch } from "../../tests/fixtures/mcp/http-fixture.ts";
import { dispatchMethod } from "../mcp-bridge/dispatch.ts";
import { copilotTools } from "../harness/copilot/tools.ts";

const mocks = vi.hoisted(() => ({ groups: {} as Record<string, NormalizedToolDef[]>, dispose: vi.fn(), launch: vi.fn(), callbacks: [] as Array<{ name: string; handler: (args: unknown) => Promise<unknown> }> }));
vi.mock("../mcp-bridge/server.ts", () => ({ getBridgeServer: async () => ({ register: (opts: { groups: Record<string, NormalizedToolDef[]> }) => {
  mocks.groups = opts.groups;
  return { bearerToken: "session-secret", urlFor: (group: string) => `http://127.0.0.1/mcp/session/${group}`, dispose: mocks.dispose };
} }) }));
vi.mock("../harness/pi/runtime.ts", () => ({ resolvePiRuntime: () => ({ executable: "pi" }), checkPiReadiness: vi.fn() }));
vi.mock("../harness/opencode/runtime.ts", () => ({ resolveOpenCodeRuntime: () => ({ executable: "opencode" }), checkOpenCodeReadiness: vi.fn() }));
vi.mock("../harness/jsonl-process.ts", () => ({ streamJsonlProcess: (opts: unknown) => mocks.launch(opts) }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ tool: (name: string, _description: string, _schema: unknown, handler: (args: unknown) => Promise<unknown>) => { const result = { name, handler }; mocks.callbacks.push(result); return result; }, createSdkMcpServer: (config: unknown) => config }));
import "../harness/pi/index.ts";
import "../harness/opencode/index.ts";
import { getHarness } from "../harness/index.ts";
import { wrapTools } from "../harness/claude/tools.ts";

let project: string;
const input = { connectionId: "fixture", name: "echo", arguments: { message: "shared broker" } };
beforeEach(() => {
  vi.clearAllMocks(); mocks.callbacks.length = 0;
  project = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-adapters-"));
  saveMcpServer(project, { id: "fixture", name: "Fixture", transport: "http", url: "https://fixture.example/mcp", headers: { Authorization: "Bearer external-secret" } });
  vi.stubGlobal("fetch", createMcpFixtureFetch());
});
afterEach(async () => { await closeConnectionScope("adapter-test"); fs.rmSync(project, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const options = (): HarnessStartOptions => ({ sessionKey: "adapter-test", cwd: project, model: "test-model", prompt: "Use a connection", systemPrompt: "Test", allowedTools: ["mcp__connections__call_tool"], abortSignal: new AbortController().signal });

describe("harness-independent connection calls", () => {
  it("Claude's SDK tool and Copilot's native tool call the same broker without external configuration", async () => {
    const defs = createConnectionTools(project, "adapter-test");
    wrapTools("connections", defs);
    const claude = await mocks.callbacks.find(t => t.name === "call_tool")!.handler(input);
    expect(JSON.stringify(claude)).toContain("shared broker");
    const native = copilotTools({ connections: defs }, ["mcp__connections__call_tool"]);
    expect(native.map(t => t.name)).toEqual(["mcp__connections__call_tool"]);
    const handler = native[0]?.handler;
    if (!handler) throw new Error("Expected Copilot connection tool to have a handler");
    const result = await handler(input, {} as never);
    expect(JSON.stringify(result)).toContain("shared broker");
    expect(JSON.stringify(native)).not.toContain("external-secret");
  });
  it.each(["pi", "opencode"] as const)("%s exposes only allowed Swarmcrews tools and disposes its bridge", async harnessName => {
    let manifestFile: string | undefined;
    mocks.launch.mockImplementation(async function* (opts: { args: string[]; env: NodeJS.ProcessEnv }) {
      expect(mocks.groups["connections"]?.map(t => t.name)).toEqual(["call_tool"]);
      expect(JSON.stringify(opts)).not.toContain("fixture.example");
      expect(JSON.stringify(opts)).not.toContain("external-secret");
      if (harnessName === "pi") {
        expect(opts.args).toContain("--extension");
        manifestFile = opts.env["SWARMCREWS_PI_TOOLS_FILE"];
        expect(manifestFile).toBeTruthy();
        const manifest = JSON.parse(fs.readFileSync(manifestFile!, "utf8"));
        expect(manifest.map((t: { name: string }) => t.name)).toEqual(["mcp__connections__call_tool"]);
        vi.stubEnv("SWARMCREWS_PI_TOOLS_FILE", manifestFile!);
        vi.stubEnv("SWARMCREWS_PI_TOOL_TOKEN", opts.env["SWARMCREWS_PI_TOOL_TOKEN"]!);
        const upstream = globalThis.fetch;
        vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
          if (url !== manifest[0].url) return upstream(url, init);
          expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-secret");
          const request = JSON.parse(String(init.body));
          return Response.json(await dispatchMethod(request, mocks.groups["connections"]!));
        });
        // Load the exact extension file passed to Pi, without launching a process.
        const extension = await import(/* @vite-ignore */ new URL("../harness/pi/swarm-tools-extension.mjs", import.meta.url).href);
        const registered: Array<{ execute: (id: string, args: unknown, signal: AbortSignal) => Promise<unknown> }> = [];
        extension.default({ registerTool: (tool: typeof registered[number]) => registered.push(tool) });
        expect(JSON.stringify(await registered[0]!.execute("call-1", input, new AbortController().signal))).toContain("shared broker");
      } else {
        const config = JSON.parse(opts.env["OPENCODE_CONFIG_CONTENT"]!);
        expect(Object.keys(config.mcp)).toEqual(["connections"]);
        expect(JSON.stringify(await dispatchMethod({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "call_tool", arguments: input } }, mocks.groups["connections"]!))).toContain("shared broker");
      }
      yield { value: { type: "agent_end", messages: [] } };
      return { code: 0, stderr: "" };
    });
    const harness = getHarness(harnessName);
    harness.registerTools({ connections: createConnectionTools(project, "adapter-test") });
    const events = [];
    for await (const event of harness.start(options()).events) events.push(event);
    expect(events.find(e => e.kind === "done" && e.reason === "error")).toBeUndefined();
    expect(mocks.launch).toHaveBeenCalledOnce(); expect(mocks.dispose).toHaveBeenCalledOnce();
    if (manifestFile) expect(fs.existsSync(manifestFile)).toBe(false);
  });
});
