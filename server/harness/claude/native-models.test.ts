import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverClaudeModels } from "./native-models.ts";
import { getClaudeModels, setClaudeModels, resolveModelAlias, supportsAdaptiveThinking } from "./models.ts";
import { checkClaudeReadiness } from "./runtime.ts";

const sdk = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => sdk);
afterEach(() => { setClaudeModels([]); vi.resetAllMocks(); });
const models = [{ value: "sonnet", resolvedModel: "claude-new-sonnet", displayName: "New Sonnet", description: "", supportsAdaptiveThinking: true }];
const runtime = { executable: "/fixture/claude", source: "env_override" as const };
const run = async () => ({ code: 0, stdout: '{"loggedIn":true,"authMethod":"oauth"}' });

describe("Claude native model discovery", () => {
  it("queries the configured SDK runtime without sending a prompt and closes it", async () => {
    const close = vi.fn();
    sdk.query.mockReturnValue({ supportedModels: async () => models, close });
    expect(await discoverClaudeModels(runtime, new AbortController().signal)).toEqual(models);
    expect(close).toHaveBeenCalledOnce();
    expect(sdk.query.mock.calls[0]![0]).toMatchObject({ options: {
      pathToClaudeCodeExecutable: runtime.executable, persistSession: false, tools: [], cwd: os.homedir(),
      settingSources: [], extraArgs: { "strict-mcp-config": null, "disable-slash-commands": null },
    } });
    expect(typeof sdk.query.mock.calls[0]![0].prompt).not.toBe("string");
  });

  it("closes the SDK on discovery failure", async () => {
    const close = vi.fn();
    sdk.query.mockReturnValue({ supportedModels: async () => { throw new Error("secret"); }, close });
    await expect(discoverClaudeModels(runtime, new AbortController().signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });

  it("cancels a hung SDK and never starts an already-aborted probe", async () => {
    const close = vi.fn();
    sdk.query.mockReturnValue({ supportedModels: () => new Promise(() => {}), close });
    const controller = new AbortController();
    const result = discoverClaudeModels(runtime, controller.signal);
    await vi.waitFor(() => expect(sdk.query).toHaveBeenCalledOnce());
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
    sdk.query.mockClear();
    await expect(discoverClaudeModels(runtime, AbortSignal.abort())).rejects.toThrow();
    expect(sdk.query).not.toHaveBeenCalled();
  });

  it("publishes discovered IDs, labels and aliases instead of hardcoded models", async () => {
    sdk.query.mockReturnValue({ supportedModels: async () => models, close: vi.fn() });
    expect(await checkClaudeReadiness({ signal: new AbortController().signal }, { resolve: () => runtime, run })).toMatchObject({ state: "ready" });
    expect(getClaudeModels()).toEqual([expect.objectContaining({ id: "claude-new-sonnet", label: "New Sonnet (claude-new-sonnet)", source: "dynamic" })]);
    expect(resolveModelAlias("sonnet")).toBe("claude-new-sonnet");
    expect(supportsAdaptiveThinking("claude-new-sonnet")).toBe(true);
  });

  it("preserves native context-window modifiers and deduplicates equivalent aliases", () => {
    setClaudeModels([
      { value: "fable[1m]", resolvedModel: "claude-fable-new", displayName: "Fable", description: "" },
      { value: "claude-fable-new[1m]", resolvedModel: "claude-fable-new", displayName: "Fable duplicate", description: "" },
    ]);
    expect(getClaudeModels()).toEqual([{ id: "claude-fable-new[1m]", label: "Fable (claude-fable-new[1m])", source: "dynamic" }]);
    expect(resolveModelAlias("fable[1m]")).toBe("claude-fable-new[1m]");
    expect(resolveModelAlias("claude-fable-new[1m]")).toBe("claude-fable-new[1m]");
  });

  it("does not publish a late response after cancellation", async () => {
    const controller = new AbortController();
    const result = await checkClaudeReadiness({ signal: controller.signal }, {
      resolve: () => runtime, run,
      discover: async () => { controller.abort(); return models; },
    });
    expect(result.state).toBe("probe_timeout");
    expect(getClaudeModels()).toEqual([]);
  });

  it("keeps native alias IDs when no resolved ID is supplied", () => {
    setClaudeModels([{ value: "opus", displayName: "Native Opus", description: "" }]);
    expect(getClaudeModels()[0]?.id).toBe("opus");
    expect(resolveModelAlias("opus")).toBe("opus");
  });

  it.each([[], "failure"])("clears stale models when discovery returns %s", async (value) => {
    setClaudeModels(models);
    sdk.query.mockReturnValue({ supportedModels: async () => { if (value === "failure") throw new Error("token-secret"); return value; }, close: vi.fn() });
    const result = await checkClaudeReadiness({ signal: new AbortController().signal }, { resolve: () => runtime, run });
    expect(result).toMatchObject({ state: "probe_failed", auth: { authenticated: true } });
    expect(JSON.stringify(result)).not.toContain("token-secret");
    expect(getClaudeModels()).toEqual([]);
  });

  it("clears stale models when the runtime disappears", async () => {
    setClaudeModels(models);
    await checkClaudeReadiness({ signal: new AbortController().signal }, { resolve: () => null });
    expect(getClaudeModels()).toEqual([]);
  });
});
