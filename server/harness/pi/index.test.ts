import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import { getHarness } from "../index.ts";
import { resolveHarnessSandboxPolicy } from "../sandbox-policy.ts";
import { streamJsonlProcess } from "../jsonl-process.ts";
import type { HarnessStartOptions, NormalizedAttachment, NormalizedEvent } from "../types.ts";
import { setPiModels } from "./models.ts";
import "./index.ts";

vi.mock("../jsonl-process.ts", () => ({ streamJsonlProcess: vi.fn() }));
vi.mock("../../mcp-bridge/server.ts", () => ({ getBridgeServer: async () => ({
  register: () => ({ bearerToken: "test-token", urlFor: () => "http://127.0.0.1/fixture", dispose: vi.fn() }),
}) }));
vi.mock("./runtime.ts", () => ({
  resolvePiRuntime: () => ({ executable: "/fixture/pi", source: "path" }),
  checkPiReadiness: vi.fn(),
}));

const image: NormalizedAttachment = {
  kind: "image", mediaType: "image/png", filename: "../../user-image.png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0uoAAAAASUVORK5CYII=",
};
const stream = vi.mocked(streamJsonlProcess);

function options(overrides: Partial<HarnessStartOptions> = {}): HarnessStartOptions {
  return { sessionKey: "pi-images", cwd: "/tmp", model: "local/vision", prompt: "Describe these images",
    systemPrompt: "Instructions", allowedTools: [], abortSignal: new AbortController().signal,
    attachments: [image], ...overrides };
}

async function collect(overrides: Partial<HarnessStartOptions> = {}): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of getHarness("pi").start(options(overrides)).events) events.push(event);
  return events;
}

function imagePaths(args: readonly string[]): string[] {
  return args.filter(arg => arg.startsWith("@")).map(arg => arg.slice(1));
}

beforeEach(() => {
  stream.mockReset();
  stream.mockImplementation(async function* () {
    yield { raw: "", value: { type: "agent_end", messages: [] } };
    return { code: 0, stderr: "" };
  });
  setPiModels([{ id: "local/vision", label: "Vision", supportsVision: true }]);
});
afterEach(() => { vi.restoreAllMocks(); setPiModels([]); getHarness("pi").registerTools({}); });

describe("Pi editing access", () => {
  it("reports sandbox axes as unmanaged without treating that as read-only", () => {
    const harness = getHarness("pi");
    expect(harness.capabilities.sandboxEnforcement).toEqual({ filesystem: [], approval: false });
    expect(resolveHarnessSandboxPolicy({ worktreeScoped: true,
      requested: { filesystemScope: "workspace-write", approvalPolicy: "on-failure" },
      support: harness.capabilities.sandboxEnforcement,
    })).toMatchObject({ effective: { filesystemScope: "unmanaged", approvalPolicy: "unmanaged" },
      unsupported: ["filesystem:workspace-write", "approval"] });
  });

  it.each([undefined, "existing-session"])("enables the authorized native editing inventory (resume=%s)", async resumeId => {
    const allowedTools = getHarness("pi").builtInTools;
    await collect({ attachments: [], allowedTools, ...(resumeId ? { resumeId } : {}) });
    const { args, cwd } = stream.mock.calls[0]![0];
    expect(args[args.indexOf("--tools") + 1]?.split(",")).toEqual(allowedTools);
    expect(allowedTools).toEqual(expect.arrayContaining(["write", "edit", "bash"]));
    expect(cwd).toBe("/tmp");
    expect(args[args.indexOf("--system-prompt") + 1]).toContain("without requesting redundant edit approval");
    expect(args[args.indexOf("--system-prompt") + 1]).toContain("explicit task restrictions still apply");
  });

  it("preserves a restricted tool inventory and includes enabled bridge tools", async () => {
    getHarness("pi").registerTools({ app: [
      { name: "lookup", description: "Lookup", inputSchema: z.object({}),
        handler: async () => ({ content: [] }) },
      { name: "hidden", description: "Hidden", inputSchema: z.object({}),
        handler: async () => ({ content: [] }) },
    ] });
    await collect({ attachments: [], allowedTools: ["read", "mcp__app__lookup"] });
    const { args } = stream.mock.calls[0]![0];
    expect(args[args.indexOf("--tools") + 1]).toBe("read,mcp__app__lookup");
    expect(args).toContain("--extension");
  });

  it("disables default tools when launch enables none", async () => {
    await collect({ attachments: [], allowedTools: [] });
    const { args } = stream.mock.calls[0]![0];
    expect(args).toContain("--no-tools");
    expect(args).not.toContain("--tools");
  });

  it.each(["default", "auto", "acceptEdits", "bypassPermissions", "plan"] as const)(
    "does not change project trust for permission mode %s", async permissionMode => {
      await collect({ attachments: [], permissionMode, allowedTools: ["read", "write", "edit"] });
      const { args } = stream.mock.calls[0]![0];
      expect(args).not.toContain("--approve");
      expect(args).not.toContain("--no-approve");
      expect(args).not.toContain("--no-sandbox");
    });
});

describe("Pi image forwarding", () => {
  it("forwards Pi's minimal thinking level and rejects an unadvertised level", async () => {
    setPiModels([{ id: "local/vision", label: "Reasoning", supportsVision: true,
      supportsReasoning: true, supportedEffortLevels: ["minimal", "max"] }]);
    await collect({ attachments: [], thinking: { effort: "minimal", display: "summarized" } });
    expect(stream.mock.calls[0]![0].args).toContain("minimal");

    stream.mockClear();
    expect(await collect({ attachments: [], thinking: { effort: "high", display: "summarized" } }))
      .toContainEqual(expect.objectContaining({ kind: "done", reason: "error",
        error: 'Pi model "local/vision" does not advertise reasoning effort "high".' }));
    expect(stream).not.toHaveBeenCalled();
  });
  it.each([undefined, "existing-session"])("forwards image bytes and removes files after completion (resume=%s)", async resumeId => {
    const attachments = (["image/png", "image/jpeg", "image/gif", "image/webp"] as const)
      .map(mediaType => ({ ...image, mediaType }));
    let files: string[] = [];
    stream.mockImplementation(async function* (input) {
      files = imagePaths(input.args);
      expect(files.map(file => path.extname(file))).toEqual([".png", ".jpg", ".gif", ".webp"]);
      for (const file of files) {
        expect(fs.readFileSync(file)).toEqual(Buffer.from(image.data, "base64"));
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
      expect(input.stdin).toBe("Describe these images");
      expect(input.args.slice(0, 4)).toEqual(["--mode", "json", "--model", "local/vision"]);
      if (resumeId) expect(input.args).toContain(resumeId);
      yield { raw: "", value: { type: "agent_end", messages: [] } };
      return { code: 0, stderr: "" };
    });
    expect(await collect({ attachments, ...(resumeId ? { resumeId } : {}) }))
      .toContainEqual(expect.objectContaining({ kind: "done", reason: "completed" }));
    expect(files).toHaveLength(4);
    expect(fs.existsSync(path.dirname(files[0]!))).toBe(false);
  });

  it.each(["exit", "throw", "abort"])("cleans up images after %s", async failure => {
    const controller = new AbortController();
    let directory = "";
    stream.mockImplementation(async function* (input) {
      directory = path.dirname(imagePaths(input.args)[0]!);
      expect(fs.existsSync(directory)).toBe(true);
      if (failure === "throw") throw new Error("spawn failed");
      if (failure === "abort") controller.abort();
      return { code: 1, stderr: "provider failed" };
    });
    expect(await collect({ abortSignal: controller.signal }))
      .toContainEqual(expect.objectContaining({ kind: "done", reason: failure === "abort" ? "abort" : "error" }));
    expect(directory).not.toBe("");
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("cleans up partially written attachments when a later write fails", async () => {
    const write = fs.writeFileSync;
    let directory = "";
    let count = 0;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, opts) => {
      directory = path.dirname(String(file));
      if (++count === 2) throw new Error("disk full");
      return write(file, data, opts);
    });
    expect(await collect({ attachments: [image, image] }))
      .toContainEqual(expect.objectContaining({ kind: "done", reason: "error", error: "disk full" }));
    expect(stream).not.toHaveBeenCalled();
    expect(count).toBe(2);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("isolates concurrent invocations sharing a session key", async () => {
    const directories: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>(resolve => { release = resolve; });
    stream.mockImplementation(async function* (input) {
      const file = imagePaths(input.args)[0]!;
      directories.push(path.dirname(file));
      if (directories.length === 2) release();
      await bothStarted;
      expect(fs.readFileSync(file)).toEqual(Buffer.from(image.data, "base64"));
      return { code: 0, stderr: "" };
    });
    await Promise.all([collect(), collect()]);
    expect(new Set(directories).size).toBe(2);
    expect(directories.every(dir => !fs.existsSync(dir))).toBe(true);
  });

  it("rejects a known text-only model before spawning Pi", async () => {
    setPiModels([{ id: "local/vision", label: "Text", supportsVision: false }]);
    expect(await collect()).toContainEqual(expect.objectContaining({ kind: "done", reason: "error",
      error: 'Pi model "local/vision" does not support images.' }));
    expect(stream).not.toHaveBeenCalled();
  });

  it("forwards images when model capability is unknown", async () => {
    setPiModels([]);
    await collect();
    expect(imagePaths(stream.mock.calls[0]![0].args)).toHaveLength(1);
  });

  it("allows text-only requests on text-only models without scratch files", async () => {
    setPiModels([{ id: "local/vision", label: "Text", supportsVision: false }]);
    const mkdtemp = vi.spyOn(fs, "mkdtempSync");
    await collect({ attachments: [] });
    expect(imagePaths(stream.mock.calls[0]![0].args)).toEqual([]);
    expect(mkdtemp).not.toHaveBeenCalled();
  });
});

describe("Pi invocation lifecycle", () => {
  it("acknowledges close only after the running stream has drained", async () => {
    let release!: () => void;
    let entered!: () => void;
    const running = new Promise<void>(resolve => { entered = resolve; });
    const exited = new Promise<void>(resolve => { release = resolve; });
    stream.mockImplementation(async function* () {
      entered();
      await exited;
      return { code: -1, stderr: "" };
    });
    const run = getHarness("pi").start(options({ attachments: [] }));
    const consume = (async () => { for await (const _event of run.events) { /* drain */ } })();
    await running;
    let closed = false;
    const closing = run.control.close!().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await Promise.all([consume, closing]);
    expect(closed).toBe(true);
  });

  it.each(["summarized", "omitted"] as const)("honors thinking display %s", async display => {
    stream.mockImplementation(async function* () {
      yield { raw: "", value: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "Reasoning" } } };
      yield { raw: "", value: { type: "agent_end" } };
      return { code: 0, stderr: "" };
    });
    const result = await collect({ attachments: [], thinking: { effort: "high", display } });
    expect(result.filter(event => event.kind === "thinking")).toHaveLength(display === "summarized" ? 1 : 0);
  });

  it("spools large system prompts to a private file and cleans it after execution", async () => {
    const systemPrompt = "Instructions ".repeat(20_000);
    let filename = "";
    stream.mockImplementation(async function* (input) {
      filename = input.args[input.args.indexOf("--system-prompt") + 1]!;
      expect(fs.readFileSync(filename, "utf8")).toContain(systemPrompt);
      expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
      yield { raw: "", value: { type: "agent_end" } };
      return { code: 0, stderr: "" };
    });
    expect(await collect({ attachments: [], systemPrompt }))
      .toContainEqual(expect.objectContaining({ kind: "done", reason: "completed" }));
    expect(fs.existsSync(filename)).toBe(false);
  });

  it("cancels while waiting for an asynchronous prompt producer", async () => {
    const controller = new AbortController();
    const prompt = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
    const result = collect({ attachments: [], prompt, abortSignal: controller.signal });
    controller.abort();
    expect(await result).toContainEqual(expect.objectContaining({ kind: "done", reason: "abort" }));
    expect(stream).not.toHaveBeenCalled();
  });

  it.each(["--help", "@private-file", "- Follow these instructions"])("passes literal prompt through stdin: %s", async prompt => {
    await collect({ attachments: [], prompt });
    const input = stream.mock.calls[0]![0];
    expect(input.stdin).toBe(prompt);
    expect(input.args).not.toContain(prompt);
  });

  it("does not launch an already cancelled invocation", async () => {
    expect(await collect({ attachments: [], abortSignal: AbortSignal.abort() }))
      .toContainEqual(expect.objectContaining({ kind: "done", reason: "abort" }));
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects reasoning on a model known to lack reasoning even without effort metadata", async () => {
    setPiModels([{ id: "local/vision", label: "Text", supportsReasoning: false }]);
    expect(await collect({ attachments: [], thinking: { effort: "high", display: "omitted" } }))
      .toContainEqual(expect.objectContaining({ kind: "done", reason: "error" }));
    expect(stream).not.toHaveBeenCalled();
  });

  it("waits for process exit and successful retry before publishing a single terminal", async () => {
    const emitted: NormalizedEvent[] = [];
    stream.mockImplementation(async function* () {
      for (const value of [
        { type: "agent_start" },
        { type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "overloaded" } },
        { type: "agent_end", willRetry: true },
        { type: "auto_retry_start", attempt: 1 },
        { type: "agent_start" },
        { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Recovered" }], stopReason: "stop" } },
        { type: "agent_end", messages: [] },
      ]) yield { raw: "", value };
      expect(emitted.filter(event => event.kind === "done")).toEqual([]);
      return { code: 0, stderr: "" };
    });
    for await (const event of getHarness("pi").start(options({ attachments: [] })).events) emitted.push(event);
    expect(emitted.filter(event => event.kind === "done"))
      .toEqual([expect.objectContaining({ reason: "completed", result: "Recovered" })]);
  });

  it("retains provider failure when Pi exits zero after agent_end", async () => {
    stream.mockImplementation(async function* () {
      yield { raw: "", value: { type: "message_end", message: {
        role: "assistant", stopReason: "error", errorMessage: "Invalid credentials",
      } } };
      yield { raw: "", value: { type: "agent_end", messages: [] } };
      return { code: 0, stderr: "" };
    });
    expect((await collect({ attachments: [] })).filter(event => event.kind === "done"))
      .toEqual([expect.objectContaining({ reason: "error", error: "Invalid credentials" })]);
  });

  it("rejects a failed exit after a successful agent_end", async () => {
    stream.mockImplementation(async function* () {
      yield { raw: "", value: { type: "agent_end", messages: [] } };
      return { code: 1, stderr: "Session persistence failed" };
    });
    expect((await collect({ attachments: [] })).filter(event => event.kind === "done"))
      .toEqual([expect.objectContaining({ reason: "error", error: "Session persistence failed" })]);
  });

  it("rejects a zero exit without a terminal event", async () => {
    stream.mockImplementation(async function* () { return { code: 0, stderr: "" }; });
    expect(await collect({ attachments: [] })).toContainEqual(expect.objectContaining({ kind: "done", reason: "error" }));
  });

  it("closes the inner stream when its consumer stops early", async () => {
    let cleaned = false;
    stream.mockImplementation(async function* (input) {
      try {
        yield { raw: "", value: { type: "session", id: "native-session" } };
        yield { raw: "", value: { type: "agent_end" } };
        return { code: 0, stderr: "" };
      } finally { cleaned = true; expect(input.signal.aborted).toBe(true); }
    });
    for await (const event of getHarness("pi").start(options({ attachments: [] })).events) {
      expect(event.kind).toBe("init");
      break;
    }
    expect(cleaned).toBe(true);
  });
});
