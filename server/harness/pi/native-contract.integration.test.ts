import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Opt-in, no downloads/CLI launch/network/inference. Point at an installed
// node_modules/@earendil-works directory. Validates that version, not all Pi versions.
const root = process.env["SWARMCREWS_PI_CONTRACT_ROOT"];
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!root)("installed Pi tool consumer contract", () => {
  it.each([false, true])("retains structured data in the next model request and persistable messages (error=%s)", async isError => {
    const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(path.join(root!, file)).href);
    const { runAgentLoop } = await load("pi-agent-core/dist/agent-loop.js");
    const { wrapToolDefinition } = await load("pi-coding-agent/dist/core/tools/tool-definition-wrapper.js");
    const extension = await import(/* @vite-ignore */ new URL("./swarm-tools-extension.mjs", import.meta.url).href);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-native-contract-")); dirs.push(directory);
    const manifest = path.join(directory, "tools.json");
    fs.writeFileSync(manifest, JSON.stringify([{ name: "lookup", sourceName: "lookup", label: "Lookup", description: "Lookup",
      inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object" }, url: "https://bridge.test" }]));
    vi.stubEnv("SWARMCREWS_PI_TOOLS_FILE", manifest); vi.stubEnv("SWARMCREWS_PI_TOOL_TOKEN", "test");
    const structuredContent = { cursor: null, rows: [{ value: null }] };
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => Response.json({ jsonrpc: "2.0",
      id: JSON.parse(String(init.body)).id, result: { content: [{ type: "text", text: "Summary" }], structuredContent, isError } }));
    let tool: unknown;
    extension.default({ registerTool: (definition: unknown) => { tool = wrapToolDefinition(definition); } });
    // Native types are intentionally runtime-loaded; Pi is an external dependency.
    const contexts: Array<{ messages: Array<{ role: string; content?: Array<{ text?: string }> }> }> = [];
    let requests = 0;
    const stream = (_model: unknown, context: typeof contexts[number]) => {
      contexts.push(structuredClone(context));
      const first = requests++ === 0;
      const message = { role: "assistant", api: "anthropic-messages", provider: "test", model: "test", timestamp: 0,
        content: first ? [{ type: "toolCall", id: "call", name: "lookup", arguments: {} }] : [{ type: "text", text: "Done" }],
        stopReason: first ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      return { async *[Symbol.asyncIterator]() { yield { type: "done", reason: message.stopReason, message }; }, result: async () => message };
    };
    const messages = await runAgentLoop([{ role: "user", content: "Lookup", timestamp: 0 }], { messages: [], tools: [tool] },
      { model: { id: "test", provider: "test", api: "anthropic-messages" }, convertToLlm: (messages: unknown) => messages },
      () => {}, undefined, stream) as Array<{ role: string; content: Array<{ text: string }>; details?: unknown; isError?: boolean }>;
    expect(requests).toBe(2);
    const next = contexts[1]!.messages.find(message => message.role === "toolResult")!;
    expect(JSON.parse(next.content![0]!.text!).structuredContent).toEqual(structuredContent);
    const persisted = JSON.parse(JSON.stringify(messages.find(message => message.role === "toolResult")));
    expect(persisted.details).toEqual({ structuredContent });
    expect(persisted.isError).toBe(isError);
    expect(JSON.parse(persisted.content[0].text).structuredContent).toEqual(structuredContent);
  });
});
