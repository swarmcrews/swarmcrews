import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod/v4";
import type { ModelInfo, SessionEvent } from "@github/copilot-sdk";
import type { HarnessStartOptions, NormalizedEvent } from "../types.ts";
import { CopilotHarness } from "./index.ts";
import { checkCopilotReadiness, resolveCopilotRuntime } from "./runtime.ts";
import { getCopilotModels, normalizeCopilotModels, setCopilotModels } from "./models.ts";
import { createCopilotTranslator } from "./translate.ts";
import { terminalProvenance } from "../terminal-provenance.ts";
import { modelPolicy, resolveLaunchModel } from "../model-policy.ts";
import { resolveMinionModelForHarness } from "../../project-model-settings.ts";

const sdk = vi.hoisted(() => {
  const state = { listener: undefined as ((event: unknown) => void) | undefined };
  const session = { sessionId: "copilot-session", send: vi.fn(), abort: vi.fn(),
    on: vi.fn((listener: (event: unknown) => void) => { state.listener = listener; return vi.fn(); }),
    rpc: { options: { update: vi.fn() }, sandbox: { getEnforcementStatus: vi.fn() } } };
  const client = { start: vi.fn(), forceStop: vi.fn(), getAuthStatus: vi.fn(), getStatus: vi.fn(),
    listModels: vi.fn(), createSession: vi.fn(), resumeSession: vi.fn() };
  return { state, session, client, constructor: vi.fn(), connection: vi.fn() };
});
vi.mock("@github/copilot-sdk", () => ({
  CopilotClient: class { constructor(options: unknown) { sdk.constructor(options); return sdk.client; } },
  RuntimeConnection: { forStdio: (options: unknown) => { sdk.connection(options); return options; } },
}));

const model: ModelInfo = {
  id: "future-model", name: "Future Model",
  capabilities: { supports: { vision: true, reasoningEffort: true },
    limits: { max_context_window_tokens: 200000, max_prompt_tokens: 180000,
      vision: { supported_media_types: ["image/png"], max_prompt_images: 10, max_prompt_image_size: 1000000 } } },
  supportedReasoningEfforts: ["low", "high"], defaultReasoningEffort: "low",
  policy: { state: "enabled", terms: "Available" }, billing: { multiplier: 0, tokenPrices: { inputPrice: 2, batchSize: 1000000 } },
};
function emit(type: string, data: unknown = {}) { sdk.state.listener?.({ type, data }); }
function options(overrides: Partial<HarnessStartOptions> = {}): HarnessStartOptions {
  return { sessionKey: "test-run", cwd: "/tmp", model: model.id, prompt: "hello", systemPrompt: "host instructions",
    allowedTools: ["view", "bash", "mcp__app__lookup"], abortSignal: new AbortController().signal, ...overrides };
}
async function collect(overrides: Partial<HarnessStartOptions> = {}) {
  const run = new CopilotHarness().start(options(overrides));
  return collectEvents(run.events);
}
async function collectEvents(stream: AsyncIterable<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

let fixture: string;
beforeEach(() => {
  vi.resetAllMocks();
  fixture = mkdtempSync(join(tmpdir(), "copilot-harness-test-"));
  const executable = join(fixture, "copilot");
  writeFileSync(executable, "#!/bin/sh\nexit 0\n"); chmodSync(executable, 0o755);
  vi.stubEnv("COPILOT_CLI_PATH", executable);
  sdk.state.listener = undefined;
  sdk.client.start.mockResolvedValue(undefined);
  sdk.client.forceStop.mockResolvedValue(undefined);
  sdk.client.getAuthStatus.mockResolvedValue({ isAuthenticated: true, authType: "user" });
  sdk.client.getStatus.mockResolvedValue({ version: "1.0.83", protocolVersion: 3 });
  sdk.client.listModels.mockResolvedValue([model]);
  sdk.client.createSession.mockResolvedValue(sdk.session);
  sdk.client.resumeSession.mockResolvedValue(sdk.session);
  sdk.session.rpc.options.update.mockResolvedValue({ success: true });
  sdk.session.rpc.sandbox.getEnforcementStatus.mockResolvedValue({ required: false, blocked: false });
  sdk.session.on.mockImplementation((listener) => { sdk.state.listener = listener; return vi.fn(); });
  sdk.session.send.mockImplementation(async () => { emit("assistant.message", { content: "answer", messageId: "m1" }); emit("session.idle"); });
  setCopilotModels([model]);
});
afterEach(() => { vi.unstubAllEnvs(); setCopilotModels([]); rmSync(fixture, { recursive: true, force: true }); });

it("rejects Pi-only minimal effort before calling the Copilot SDK", async () => {
  setCopilotModels([{ ...model, supportedReasoningEfforts: ["minimal"] as unknown as ModelInfo["supportedReasoningEfforts"] }]);
  expect(await collect({ thinking: { effort: "minimal", display: "summarized" } }))
    .toContainEqual(expect.objectContaining({ kind: "done", reason: "error",
      error: 'Copilot does not support reasoning effort "minimal".' }));
  expect(sdk.client.createSession).not.toHaveBeenCalled();
});

describe("Copilot detection and model discovery", () => {
  it("detects PATH and explicit override without falling back from a bad override", () => {
    expect(resolveCopilotRuntime({ PATH: fixture })?.source).toBe("path");
    expect(resolveCopilotRuntime({ COPILOT_CLI_PATH: join(fixture, "copilot") })?.source).toBe("env_override");
    expect(resolveCopilotRuntime({ PATH: fixture, COPILOT_CLI_PATH: join(fixture, "missing") })).toBeNull();
  });
  it("uses the detected executable for SDK authentication and catalog probing", async () => {
    const result = await checkCopilotReadiness({ signal: new AbortController().signal });
    expect(result).toMatchObject({ state: "ready", runtime: { version: "1.0.83", source: "env_override" }, auth: { authenticated: true } });
    expect(sdk.connection).toHaveBeenCalledWith({ path: join(fixture, "copilot") });
    expect(sdk.client.createSession).not.toHaveBeenCalled();
    expect(sdk.client.forceStop).toHaveBeenCalled();
    expect(getCopilotModels()[0]).toMatchObject({ id: model.id, source: "dynamic", supportedEffortLevels: ["low", "high"] });
  });
  it("clears stale models when logged out, missing, or failed", async () => {
    sdk.client.getAuthStatus.mockResolvedValue({ isAuthenticated: false });
    expect((await checkCopilotReadiness({ signal: new AbortController().signal })).state).toBe("unauthenticated");
    expect(getCopilotModels()).toEqual([]);
    setCopilotModels([model]);
    expect((await checkCopilotReadiness({ signal: new AbortController().signal }, { resolve: () => null })).state).toBe("runtime_missing");
    expect(getCopilotModels()).toEqual([]);
    sdk.client.getAuthStatus.mockRejectedValue(new Error("rpc failed"));
    expect((await checkCopilotReadiness({ signal: new AbortController().signal })).state).toBe("probe_failed");
  });
  it("cancels probes without publishing late model results", async () => {
    const controller = new AbortController();
    sdk.client.listModels.mockImplementation(async () => { controller.abort(); return [model]; });
    expect((await checkCopilotReadiness({ signal: controller.signal })).state).toBe("probe_timeout");
    expect(getCopilotModels()).toEqual([]);
    expect(sdk.client.forceStop).toHaveBeenCalled();
  });
  it("preserves capability, policy and billing metadata and excludes disabled launch models", () => {
    const disabled = { ...model, id: "disabled", policy: { state: "disabled" as const, terms: "Ask administrator" } };
    setCopilotModels([model, model, disabled]);
    expect(normalizeCopilotModels([model])[0]).toMatchObject({ contextWindowTokens: 200000, maxPromptTokens: 180000,
      supportsVision: true, vision: { maxImages: 10 }, billing: { multiplier: 0, unit: "AI credits", tokenPrices: { batchSize: 1000000 } } });
    expect(getCopilotModels()).toHaveLength(2);
    expect(new CopilotHarness().staticInfo().models.map((entry) => entry.id)).toEqual([model.id]);
    expect(modelPolicy("copilot")?.leader).toEqual([model.id]);
    expect(resolveLaunchModel({ requestedHarness: "copilot", effectiveHarness: "copilot", requestedModel: model.id, role: "leader" })).toEqual({ model: model.id, incompatible: false });
    expect(resolveMinionModelForHarness({ defaultMinionModel: model.id }, "copilot", "standard")).toBe(model.id);
  });
  it("preserves explicitly selected shared vendor IDs in adaptive project defaults", () => {
    setCopilotModels([model, { ...model, id: "gpt-5.6-sol" }]);
    expect(resolveMinionModelForHarness({ adaptiveMinionModelRouting: true, defaultMinionModel: "gpt-5.6-sol" }, "copilot", "standard")).toBe("gpt-5.6-sol");
  });
});

describe("Copilot SDK runs", () => {
  it.each([undefined, "old-session"])("enforces read-only policy before prompting, including resume %s", async (resumeId) => {
    sdk.session.send.mockImplementation(async () => {
      expect(sdk.session.rpc.options.update).toHaveBeenCalledWith(expect.objectContaining({
        sandboxConfig: expect.objectContaining({ enabled: true, allowBypass: false,
          addCurrentWorkingDirectory: false, allowDevToolAccess: false,
          userPolicy: { filesystem: expect.objectContaining({ readwritePaths: [], readonlyPaths: expect.arrayContaining([fixture]) }) } }),
      }));
      const config = (resumeId ? sdk.client.resumeSession.mock.calls[0]![1] : sdk.client.createSession.mock.calls[0]![0]);
      expect(config).toMatchObject({ enableConfigDiscovery: false, enableFileHooks: false, enableHostGitOperations: false });
      expect(config.onPermissionRequest({ kind: "shell" })).toEqual({ kind: "approve-once" });
      expect(config.onPermissionRequest({ kind: "write", fileName: join(fixture, "file") })).toEqual({ kind: "user-not-available" });
      emit("session.idle");
    });
    expect((await collect({ cwd: fixture, resumeId,
      sandboxPolicy: { requested: { filesystemScope: "read-only", approvalPolicy: "never" },
        effective: { filesystemScope: "read-only", approvalPolicy: "never" }, unsupported: [] } })).at(-1))
      .toMatchObject({ reason: "completed" });
  });

  it.each(["rejected", "missing RPC", "blocked"])("never prompts after sandbox setup is %s", async (failure) => {
    if (failure === "rejected") sdk.session.rpc.options.update.mockResolvedValue({ success: false });
    if (failure === "missing RPC") sdk.session.rpc.options.update.mockRejectedValue(new Error("Method not found"));
    if (failure === "blocked") sdk.session.rpc.sandbox.getEnforcementStatus.mockResolvedValue({ blocked: true, reason: "No backend" });
    expect((await collect()).at(-1)).toMatchObject({ reason: "error" });
    expect(sdk.session.send).not.toHaveBeenCalled();
    expect(sdk.client.forceStop).toHaveBeenCalled();
  });
  it("streams init, deltas, text and exactly one provider terminal, then cleans up", async () => {
    sdk.session.send.mockImplementation(async () => {
      emit("assistant.message_delta", { deltaContent: "ans", messageId: "m1" });
      emit("assistant.message", { content: "answer", messageId: "m1" });
      emit("session.idle"); emit("session.idle");
    });
    const events = await collect();
    expect(events.map((event) => event.kind)).toEqual(["init", "text_delta", "stream_end", "text", "done"]);
    const terminal = events.at(-1)!;
    expect(terminal).toMatchObject({ reason: "completed", result: "answer" });
    if (terminal.kind === "done") expect(terminalProvenance(terminal)).toBe("provider");
    expect(sdk.client.forceStop).toHaveBeenCalled();
  });
  it("resumes with current instructions, model, allowed tools and attachments", async () => {
    await collect({ resumeId: "old-session", thinking: { effort: "high", display: "summarized" },
      attachments: [{ kind: "image", mediaType: "image/png", data: "aGVsbG8=" }] });
    expect(sdk.client.resumeSession).toHaveBeenCalledWith("old-session", expect.objectContaining({ model: model.id,
      systemMessage: { mode: "append", content: "host instructions" }, reasoningEffort: "high", availableTools: ["builtin:view", "builtin:bash"] }));
    expect(sdk.client.createSession).not.toHaveBeenCalled();
    expect(sdk.session.send).toHaveBeenCalledWith(expect.objectContaining({ attachments: [{ type: "blob", data: "aGVsbG8=", mimeType: "image/png" }] }));
  });
  it("validates and forwards only allowed application tools, including error results", async () => {
    const harness = new CopilotHarness();
    const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "failed lookup" }], isError: true }));
    harness.registerTools({ app: [
      { name: "lookup", description: "Lookup", inputSchema: z.object({ id: z.string() }), handler },
      { name: "secret", description: "Unavailable", inputSchema: z.object({}), handler },
    ] });
    await collectEvents(harness.start(options()).events);
    const config = sdk.client.createSession.mock.calls[0]![0];
    expect(config.tools.map((tool: { name: string }) => tool.name)).toEqual(["mcp__app__lookup"]);
    expect(await config.tools[0].handler({ id: "x" })).toMatchObject({ resultType: "failure", textResultForLlm: "failed lookup" });
    expect(await config.tools[0].handler({ id: 1 })).toMatchObject({ resultType: "failure" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it("supports open input streams without waiting for producer completion", async () => {
    async function* prompt() { yield { role: "user" as const, content: "first" }; await new Promise(() => {}); }
    expect((await collect({ prompt: prompt() })).at(-1)).toMatchObject({ reason: "completed" });
  });
  it("cancels before startup and while waiting for provider events", async () => {
    const controller = new AbortController(); controller.abort();
    expect((await collect({ abortSignal: controller.signal })).map((event) => event.kind)).toEqual(["init", "done"]);
    expect(sdk.client.start).not.toHaveBeenCalled();
    sdk.session.send.mockImplementation(async () => {});
    const run = new CopilotHarness().start(options());
    const iterator = run.events[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ kind: "init" });
    const pending = iterator.next();
    run.control.abort();
    expect((await pending).value).toMatchObject({ kind: "done", reason: "abort" });
    await iterator.next();
    expect(sdk.client.forceStop).toHaveBeenCalled();
  });
  it("normalizes startup, send, and provider errors", async () => {
    sdk.client.start.mockRejectedValueOnce(new Error("start failed"));
    expect((await collect()).at(-1)).toMatchObject({ reason: "error", error: "start failed" });
    sdk.session.send.mockRejectedValueOnce(new Error("send failed"));
    expect((await collect()).at(-1)).toMatchObject({ reason: "error", error: "send failed" });
    sdk.session.send.mockImplementationOnce(async () => emit("session.error", { message: "provider failed" }));
    expect((await collect()).at(-1)).toMatchObject({ reason: "error", error: "provider failed" });
  });
  it("does not confuse Copilot billing multipliers with USD", () => {
    const translator = createCopilotTranslator(false);
    const events = translator.translate({ type: "assistant.usage", data: { model: model.id, inputTokens: 9, outputTokens: 3, cost: 3 } } as SessionEvent);
    expect(events).toEqual([{ kind: "usage", source: "assistant", input: 9, output: 3 }]);
  });
  it("wires permission decisions into sessions and denies requests after cleanup", async () => {
    await collect({ permissionMode: "default" });
    let permission = sdk.client.createSession.mock.calls[0]![0].onPermissionRequest;
    expect(permission({ kind: "shell" })).toMatchObject({ kind: "user-not-available" });
    expect(permission({ kind: "read" })).toMatchObject({ kind: "user-not-available" }); // run has closed
    const run = new CopilotHarness().start(options({ permissionMode: "bypassPermissions" }));
    const iterator = run.events[Symbol.asyncIterator]();
    await iterator.next();
    permission = sdk.client.createSession.mock.calls.at(-1)![0].onPermissionRequest;
    expect(permission({ kind: "shell" })).toMatchObject({ kind: "approve-once" });
    expect(permission({ kind: "shell", managedApprovalRequired: true })).toMatchObject({ kind: "user-not-available" });
    await iterator.return?.();
  });
});
