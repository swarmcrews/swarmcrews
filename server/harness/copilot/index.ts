import type { CopilotClient, CopilotSession, SessionConfig } from "@github/copilot-sdk";
import { registerHarness } from "../index.ts";
import type { AgentHarness, HarnessCapabilities, HarnessRunControl, HarnessStartOptions, HarnessStaticInfo, NormalizedEvent, NormalizedToolDef } from "../types.ts";
import { tagTerminalProvenance, trackHarnessDrain, HARNESS_DRAIN, type DrainableHarnessControl } from "../terminal-provenance.ts";
import { checkCopilotReadiness, createCopilotClient, resolveCopilotRuntime } from "./runtime.ts";
import { getCopilotModels, selectableCopilotModels } from "./models.ts";
import { copilotTools } from "./tools.ts";
import { createCopilotTranslator } from "./translate.ts";
import { copilotPermissionHandler } from "./permissions.ts";
import { applyCopilotSandbox, copilotSandboxHooks } from "./sandbox.ts";

export class CopilotHarness implements AgentHarness {
  readonly name = "copilot";
  readonly exposure = "production" as const;
  readonly capabilities: HarnessCapabilities = {
    mutationInterception: "observe_only", thinking: true, promptCaching: true,
    mcp: false, permissionPrompts: false, resume: true, partialMessages: true,
    builtInFilesystem: true,
    // Native per-session sandbox plus path checks for in-process file tools.
    sandboxEnforcement: { filesystem: ["read-only", "workspace-write", "unrestricted"], approval: true },
  };
  readonly builtInTools = ["view", "create", "edit", "bash", "powershell", "read_bash", "write_bash", "stop_bash", "glob", "grep", "web_fetch"];
  readonly checkReadiness = checkCopilotReadiness;
  private groups: Record<string, NormalizedToolDef[]> = {};

  registerTools(groups: Record<string, NormalizedToolDef[]>): void { this.groups = groups; }
  resolveModel(model: string): string | null { return model?.trim() || null; }
  staticInfo(): HarnessStaticInfo {
    return { models: selectableCopilotModels(), commands: [], agents: [], account: { provider: "github" } };
  }

  start(opts: HarnessStartOptions): { events: AsyncIterable<NormalizedEvent>; control: HarnessRunControl } {
    const controller = new AbortController();
    let client: CopilotClient | undefined;
    let session: CopilotSession | undefined;
    let wake: (() => void) | undefined;
    const abort = () => {
      controller.abort();
      wake?.();
      void client?.forceStop().catch(() => {});
    };
    opts.abortSignal.addEventListener("abort", abort, { once: true });
    if (opts.abortSignal.aborted) abort();
    // Capture the registry before another session registers its tools.
    const tools = copilotTools(this.groups, opts.allowedTools);
    const builtin = this.builtInTools.filter((name) => opts.allowedTools.includes(name));
    const translator = createCopilotTranslator(opts.thinking?.display === "summarized");

    const events = (async function* (): AsyncGenerator<NormalizedEvent> {
      let initialized = false;
      let unsubscribe: (() => void) | undefined;
      const queue: NormalizedEvent[] = [];
      let terminal: Extract<NormalizedEvent, { kind: "done" }> | undefined;
      let input: AsyncIterator<{ role: "user"; content: string }> | undefined;
      const push = (event: NormalizedEvent) => { queue.push(event); wake?.(); };
      let sandboxApplied = false;
      try {
        controller.signal.throwIfAborted();
        if (Object.keys(opts.externalMcpServers ?? {}).length) {
          throw new Error('External project MCP wrappers are not supported by harness "copilot".');
        }
        const runtime = resolveCopilotRuntime();
        if (!runtime) throw new Error("Copilot runtime unavailable. Install copilot or set COPILOT_CLI_PATH.");
        const model = getCopilotModels().find((entry) => entry.id === opts.model);
        if (model?.policy?.state === "disabled") throw new Error(`Copilot model "${opts.model}" is disabled by policy.`);
        if (opts.attachments?.length && model?.supportsVision === false) throw new Error(`Copilot model "${opts.model}" does not support images.`);
        const effort = opts.thinking?.effort;
        if (effort === "minimal") throw new Error('Copilot does not support reasoning effort "minimal".');
        if (opts.thinking && !model?.supportedEffortLevels?.includes(opts.thinking.effort)) {
          throw new Error(`Copilot model "${opts.model}" does not advertise reasoning effort "${opts.thinking.effort}".`);
        }
        client = await createCopilotClient(runtime, opts.cwd);
        controller.signal.throwIfAborted();
        await client.start();
        controller.signal.throwIfAborted();
        const config: SessionConfig = {
          model: opts.model, workingDirectory: opts.cwd, streaming: true,
          // No ambient hook or host Git work may run before policy is applied.
          enableConfigDiscovery: false, enableFileHooks: false, enableHostGitOperations: false,
          systemMessage: { mode: "append", content: opts.systemPrompt },
          tools, availableTools: [...builtin.map((name) => `builtin:${name}`), ...tools.map((tool) => `custom:${tool.name}`)],
          ...(effort ? { reasoningEffort: effort } : {}),
          onPermissionRequest: copilotPermissionHandler(opts, controller.signal, push, () => sandboxApplied),
          hooks: copilotSandboxHooks(opts, controller.signal),
        };
        session = opts.resumeId
          ? await client.resumeSession(opts.resumeId, config)
          : await client.createSession(config);
        await applyCopilotSandbox(session, opts);
        sandboxApplied = true;
        controller.signal.throwIfAborted();
        yield { kind: "init", sessionId: session.sessionId, model: opts.model,
          ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}) };
        initialized = true;
        unsubscribe = session.on((event) => {
          if (terminal) return;
          for (const translated of translator.translate(event)) push(translated);
          if (event.type === "session.idle") {
            terminal = tagTerminalProvenance({ kind: "done", reason: "completed", result: translator.result() }, "provider");
          } else if (event.type === "session.error") {
            terminal = tagTerminalProvenance({ kind: "done", reason: "error", error: event.data.message }, "provider");
          }
          wake?.();
        });
        // Feed a live input stream without waiting for it to close before sending.
        const feed = async () => {
          let first = true;
          const send = async (prompt: string) => {
            if (terminal || controller.signal.aborted) return;
            await session!.send({ prompt,
              ...(first && opts.attachments?.length ? { attachments: opts.attachments.map((attachment) => ({
                type: "blob" as const, data: attachment.data, mimeType: attachment.mediaType,
                ...(attachment.filename ? { displayName: attachment.filename } : {}),
              })) } : {}),
            });
            first = false;
          };
          if (typeof opts.prompt === "string") await send(opts.prompt);
          else {
            input = opts.prompt[Symbol.asyncIterator]();
            while (!terminal && !controller.signal.aborted) {
              const next = await input.next();
              if (next.done) break;
              await send(next.value.content);
            }
            if (first && !terminal) throw new Error("Copilot received no prompt.");
          }
        };
        void feed().catch((error: unknown) => {
          if (!terminal) terminal = tagTerminalProvenance({ kind: "done", reason: "error", error: error instanceof Error ? error.message : "Copilot send failed" }, "adapter");
          wake?.();
        });
        while (!controller.signal.aborted) {
          while (queue.length) yield queue.shift()!;
          if (terminal) { yield terminal; return; }
          await new Promise<void>((resolve) => { wake = resolve; });
        }
        yield tagTerminalProvenance({ kind: "done", reason: "abort" }, "adapter");
      } catch (error) {
        if (!initialized) yield { kind: "init", sessionId: opts.resumeId ?? opts.sessionKey, model: opts.model };
        yield tagTerminalProvenance(controller.signal.aborted ? { kind: "done", reason: "abort" }
          : { kind: "done", reason: "error", error: error instanceof Error ? error.message : "Copilot adapter failed" }, "adapter");
      } finally {
        controller.abort();
        opts.abortSignal.removeEventListener("abort", abort);
        unsubscribe?.();
        // An async producer may still be waiting for host input; never block cleanup on it.
        void input?.return?.().catch(() => {});
        await client?.forceStop().catch(() => {});
      }
    })();
    const tracked = trackHarnessDrain(events);
    const control: DrainableHarnessControl = {
      abort, close: async () => { abort(); await client?.forceStop().catch(() => {}); },
      interrupt: async () => { if (session) await session.abort(); },
      getContextUsage: async () => translator.context() ?? null,
      [HARNESS_DRAIN]: tracked.drain,
    };
    return { events: tracked.events, control };
  }
}

registerHarness(new CopilotHarness());
