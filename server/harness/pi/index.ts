import { registerHarness } from "../index.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { getBridgeServer } from "../../mcp-bridge/server.ts";
import type { McpBridgeRegistration } from "../../mcp-bridge/registry.ts";
import type {
  AgentHarness,
  HarnessCapabilities,
  HarnessRunControl,
  HarnessStartOptions,
  HarnessStaticInfo,
  NormalizedAttachment,
  NormalizedEvent,
  NormalizedToolDef,
} from "../types.ts";
import { streamJsonlProcess } from "../jsonl-process.ts";
import { HARNESS_DRAIN, tagTerminalProvenance, type DrainableHarnessControl } from "../terminal-provenance.ts";
import { getPiModels, resolvePiModel } from "./models.ts";
import { checkPiReadiness, resolvePiRuntime } from "./runtime.ts";
import { createPiTranslator } from "./translate.ts";
import type { PiTranslator } from "./translate.ts";

const CAPABILITIES: HarnessCapabilities = {
  mutationInterception: "observe_only",
  thinking: true,
  promptCaching: true,
  mcp: false,
  permissionPrompts: false,
  resume: true,
  partialMessages: true,
  builtInFilesystem: true,
  // Pi has native editing tools, but no built-in filesystem sandbox or approval gate.
  sandboxEnforcement: { filesystem: [], approval: false },
};

const BUILT_IN_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"];
const EXECUTION_GUIDANCE = [
  "Pi execution permissions: filesystem and approval policies are unmanaged by this harness.",
  "Unmanaged does not mean read-only or awaiting authorization. Use the enabled native tools to perform user-authorized changes within the task's assigned scope without requesting redundant edit approval.",
  "Pi has no native permission escalation prompt. OS permissions, configured extensions, and explicit task restrictions still apply; report an actual denied operation rather than assuming a sandbox blocks edits.",
].join("\n");
const IMAGE_EXTENSIONS: Record<NormalizedAttachment["mediaType"], string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
};

class PiHarness implements AgentHarness {
  readonly name = "pi";
  readonly exposure = "production" as const;
  readonly capabilities = CAPABILITIES;
  readonly builtInTools = [...BUILT_IN_TOOLS];
  readonly checkReadiness = checkPiReadiness;

  private registeredGroups: Record<string, NormalizedToolDef[]> = {};
  registerTools(toolGroups: Record<string, NormalizedToolDef[]>): void { this.registeredGroups = toolGroups; }

  resolveModel(model: string): string | null {
    return resolvePiModel(model);
  }

  staticInfo(): HarnessStaticInfo {
    return {
      models: getPiModels(),
      commands: [],
      agents: [],
      account: { provider: "pi" },
    };
  }

  start(opts: HarnessStartOptions): { events: AsyncIterable<NormalizedEvent>; control: HarnessRunControl } {
    const controller = new AbortController();
    const abort = () => controller.abort();
    opts.abortSignal.addEventListener("abort", abort, { once: true });
    if (opts.abortSignal.aborted) controller.abort();
    const allowed = new Set(opts.allowedTools);
    const groups: Record<string, NormalizedToolDef[]> = {};
    for (const [group, defs] of Object.entries(this.registeredGroups)) {
      const enabled = defs.filter(def => allowed.has(`mcp__${group}__${def.name}`));
      if (enabled.length) groups[group] = enabled;
    }

    let started = false;
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const events = (async function* (): AsyncGenerator<NormalizedEvent> {
      started = true;
      let translator: PiTranslator | undefined;
      let stream: ReturnType<typeof streamJsonlProcess> | undefined;
      let bridge: McpBridgeRegistration | undefined;
      let manifestDirectory: string | undefined;
      let attachmentDirectory: string | undefined;
      let promptDirectory: string | undefined;
      try {
        if (controller.signal.aborted) {
          yield fallbackInit(opts);
          yield tagTerminalProvenance({ kind: "done", reason: "abort" }, "adapter");
          return;
        }
        const model = getPiModels().find(candidate => candidate.id === opts.model);
        if (opts.thinking && (model?.supportsReasoning === false || (model?.supportedEffortLevels
          && !model.supportedEffortLevels.includes(opts.thinking.effort)))) {
          yield fallbackInit(opts);
          yield taggedError(`Pi model "${opts.model}" does not advertise reasoning effort "${opts.thinking.effort}".`);
          return;
        }
        if (opts.attachments?.length && model?.supportsVision === false) {
          yield fallbackInit(opts);
          yield taggedError(`Pi model "${opts.model}" does not support images.`);
          return;
        }
        if (Object.keys(opts.externalMcpServers ?? {}).length > 0) {
          yield fallbackInit(opts);
          yield taggedError("External project MCP wrappers are not supported by harness \"pi\"; configure tools through Pi extensions.");
          return;
        }
        const runtime = resolvePiRuntime();
        if (!runtime) {
          yield fallbackInit(opts);
          yield taggedError("Pi runtime is unavailable. Install pi or set PI_PATH.");
          return;
        }
        const prompt = await collectPrompt(opts.prompt, controller.signal);
        controller.signal.throwIfAborted();
        let systemPrompt = `${opts.systemPrompt}\n\n${EXECUTION_GUIDANCE}`;
        // Pi accepts a prompt file; avoid the OS per-argument limit for large contexts.
        if (Buffer.byteLength(systemPrompt) > 64 * 1024) {
          promptDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcrews-pi-prompt-"));
          const filename = path.join(promptDirectory, "system.txt");
          fs.writeFileSync(filename, systemPrompt, { mode: 0o600 });
          systemPrompt = filename;
        }
        const args = ["--mode", "json", "--model", opts.model, "--system-prompt", systemPrompt];
        const toolNames = [
          ...BUILT_IN_TOOLS.filter(name => allowed.has(name)),
          ...Object.entries(groups).flatMap(([group, defs]) => defs.map(def => `mcp__${group}__${def.name}`)),
        ];
        // Explicit selection also restores the launch inventory on resumed sessions.
        if (toolNames.length) args.push("--tools", toolNames.join(","));
        else args.push("--no-tools");
        const env = { ...process.env };
        if (Object.keys(groups).length) {
          bridge = (await getBridgeServer()).register({ sessionKey: opts.sessionKey, groups });
          env["SWARMCREWS_PI_TOOL_TOKEN"] = bridge.bearerToken;
          manifestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcrews-pi-tools-"));
          env["SWARMCREWS_PI_TOOLS_FILE"] = path.join(manifestDirectory, "tools.json");
          fs.writeFileSync(env["SWARMCREWS_PI_TOOLS_FILE"], JSON.stringify(Object.entries(groups).flatMap(([group, defs]) => defs.map(def => ({
            name: `mcp__${group}__${def.name}`, label: def.name, sourceName: def.name, description: def.description,
            inputSchema: z.toJSONSchema(def.inputSchema), url: bridge!.urlFor(group),
          })))), { mode: 0o600 });
          args.push("--extension", fileURLToPath(new URL("./swarm-tools-extension.mjs", import.meta.url)));
        }
        if (opts.resumeId) args.push("--session", opts.resumeId);
        // Omission lets Pi retain its global/session default, even after the UI disables reasoning.
        args.push("--thinking", opts.thinking?.effort ?? "off");
        // --approve controls project-resource trust, not permission to edit files.
        // Leave trust to Pi's saved settings instead of deriving it from permissionMode.
        if (opts.attachments?.length) {
          // Unique per invocation: resumed or overlapping runs must not delete each other's images.
          attachmentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcrews-pi-attachments-"));
          for (const [index, attachment] of opts.attachments.entries()) {
            const extension = IMAGE_EXTENSIONS[attachment.mediaType];
            if (!extension) throw new Error(`Unsupported Pi image media type: ${attachment.mediaType}`);
            const filename = path.join(attachmentDirectory, `attachment-${index}.${extension}`);
            fs.writeFileSync(filename, Buffer.from(attachment.data, "base64"), { mode: 0o600 });
            args.push(`@${filename}`);
          }
        }
        translator = createPiTranslator(opts.model, opts.resumeId ?? opts.sessionKey, opts.permissionMode);
        stream = streamJsonlProcess({ executable: runtime.executable, args, cwd: opts.cwd, env,
          signal: controller.signal, stdin: prompt });
        let completion;
        let terminal: Extract<NormalizedEvent, { kind: "done" }> | undefined;
        while (true) {
          const next = await stream.next();
          if (next.done) { completion = next.value; break; }
          if (next.value.value === undefined) continue;
          for (const event of translator.translate(next.value.value)) {
            if (event.kind === "done") terminal = event;
            else if (event.kind === "thinking" && opts.thinking?.display !== "summarized") continue;
            else yield event;
          }
        }
        for (const event of translator.ensureInit()) yield event;
        yield { kind: "stream_end" };
        if (controller.signal.aborted) {
          yield tagTerminalProvenance({ kind: "done", reason: "abort" }, "adapter");
        } else if (completion.code !== 0) {
          yield taggedError(completion.stderr || `Pi exited with status ${completion.code}`);
        } else if (terminal && translator.terminalSeen()) {
          yield tagTerminalProvenance(terminal, "adapter");
        } else {
          yield taggedError("Pi exited without a final agent_end event.");
        }
      } catch (error) {
        if (translator) {
          for (const event of translator.ensureInit()) yield event;
        } else {
          yield fallbackInit(opts);
        }
        yield controller.signal.aborted
          ? tagTerminalProvenance({ kind: "done", reason: "abort" }, "adapter")
          : taggedError(error instanceof Error ? error.message : "Pi adapter failed");
      } finally {
        controller.abort();
        opts.abortSignal.removeEventListener("abort", abort);
        try {
          await stream?.return({ code: -1, stderr: "" });
        } finally {
          bridge?.dispose();
          try {
            if (attachmentDirectory) fs.rmSync(attachmentDirectory, { recursive: true, force: true });
            if (manifestDirectory) fs.rmSync(manifestDirectory, { recursive: true, force: true });
            if (promptDirectory) fs.rmSync(promptDirectory, { recursive: true, force: true });
          } finally { finish(); }
        }
      }
    })();

    const control: DrainableHarnessControl = { abort, [HARNESS_DRAIN]: finished, close: async () => {
      abort();
      if (started) await finished;
      else { opts.abortSignal.removeEventListener("abort", abort); finish(); }
    } };
    return { events, control };
  }
}

async function collectPrompt(prompt: HarnessStartOptions["prompt"], signal: AbortSignal): Promise<string> {
  if (typeof prompt === "string") return prompt;
  const messages: string[] = [];
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("Pi prompt collection aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const iterator = prompt[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), cancelled]);
      if (next.done) break;
      messages.push(next.value.content);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    // A producer may still be awaiting input; do not block cancellation on it.
    void iterator.return?.().catch(() => {});
  }
  return messages.join("\n\n");
}

function taggedError(message: string): NormalizedEvent {
  return tagTerminalProvenance({ kind: "done", reason: "error", error: message }, "adapter");
}

function fallbackInit(opts: HarnessStartOptions): NormalizedEvent {
  return { kind: "init", sessionId: opts.resumeId ?? opts.sessionKey, model: opts.model,
    ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}) };
}

registerHarness(new PiHarness());
