import { expect, it } from "vitest";
import { z } from "zod/v4";
import { BROWSER_RUNNER_MCP_TOOLS } from "../../shared/browser-runner.ts";
import { createBrowserRunnerTools, installBrowserRunnerTools } from "../../server/browser-runner/tools.ts";
import { BrowserRunnerService } from "../../server/browser-runner/service.ts";
import { dispatchMethod } from "../../server/mcp-bridge/dispatch.ts";
import { toolDescriptor } from "../../server/harness/tool-contract.ts";
import type { AgentTypeContext, AgentToolResult } from "../../server/agents/types.ts";

const principal = { sessionKey: "no-grant", projectPath: process.cwd(), cwd: process.cwd() };
const service = new BrowserRunnerService(() => ({ version: 1, maxConcurrent: 1, runners: [] }), { execute: async () => { throw new Error("Must not execute"); } });
it("registers exact shared tool identities for any leader/minion context", () => {
  const result: AgentToolResult = { toolGroups: {}, mcpToolNames: [] };
  installBrowserRunnerTools({ ...principal, worktreeInfo: null } as AgentTypeContext, result, new AbortController().signal);
  expect(result.mcpToolNames).toEqual(BROWSER_RUNNER_MCP_TOOLS);
  expect(result.mcpToolNames).toEqual(result.toolGroups["browser-runner"]!.map(d => `mcp__browser-runner__${d.name}`));
  for (const def of result.toolGroups["browser-runner"]!) {
    const descriptor = toolDescriptor(def);
    expect(descriptor.inputSchema.type).toBe("object"); expect(descriptor.outputSchema?.type).toBe("object");
  }
});
it("explains unconfigured resources with caller-only identity and still denies execution", async () => {
  const defs = createBrowserRunnerTools(principal, new AbortController().signal, false, service);
  const listed = await dispatchMethod({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_runners", arguments: {} } }, defs);
  expect(listed.result).toMatchObject({ structuredContent: { result: {
    status: "not_configured", runners: [], preflight: "not_run",
    authorizationRequest: { sessionKey: principal.sessionKey, projectPath: principal.projectPath, worktrees: [principal.cwd] },
  } } });
  const denied = await dispatchMethod({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "run_tests", arguments: { runnerId: "local", suite: "smoke" } } }, defs);
  expect(denied.result).toMatchObject({ isError: true });
});
it("returns safe policy diagnostics through MCP rather than a generic tool error", async () => {
  const unavailable = new BrowserRunnerService(() => { throw new Error("sensitive operator JSON details"); }, { execute: async () => { throw new Error("Must not execute"); } });
  const defs = createBrowserRunnerTools(principal, new AbortController().signal, false, unavailable);
  const response = await defs.find(d => d.name === "list_runners")!.handler({});
  expect(response).toMatchObject({ structuredContent: { result: { status: "policy_unavailable", runners: [] } } });
  expect(JSON.stringify(response)).not.toContain("sensitive operator JSON details");
  expect(response.isError).not.toBe(true);
});
it("rejects arbitrary commands, caller identity and workspace overrides at the schema boundary", () => {
  const defs = createBrowserRunnerTools(principal, new AbortController().signal, false, service);
  const schema = defs.find(d => d.name === "run_tests")!.inputSchema as z.ZodType;
  expect(schema.safeParse({ runnerId: "local", suite: "smoke", command: "sh", cwd: "/", sessionKey: "leader", sourceExclusions: ["src"] }).success).toBe(false);
  expect(schema.safeParse({ runnerId: "local", suite: "smoke; rm -rf /" }).success).toBe(false);
});
it("planning and aborted invocations cannot perform mutations", async () => {
  const signal = new AbortController();
  const defs = createBrowserRunnerTools(principal, signal.signal, true, service);
  expect(await defs.find(d => d.name === "grant_access")!.handler({ runnerId: "local", sessionKey: "child", suites: ["smoke"], ttlSeconds: 60 })).toMatchObject({ isError: true });
  signal.abort(); expect(await defs[0]!.handler({})).toMatchObject({ isError: true });
});
