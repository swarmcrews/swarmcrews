import * as os from "node:os";
import { query, type ModelInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeRuntime } from "./runtime.ts";

/** Initialize only: no user turn, tools, or persisted conversation. Keep stdin
 * open until supportedModels resolves; an empty iterable closes it too early. */
export async function discoverClaudeModels(runtime: ClaudeRuntime, signal: AbortSignal): Promise<ModelInfo[]> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  async function* prompt(): AsyncGenerator<SDKUserMessage> { await finished; }
  let handle: ReturnType<typeof query> | undefined;
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new Error("Claude model discovery aborted"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    handle = query({ prompt: prompt(), options: {
      pathToClaudeCodeExecutable: runtime.executable,
      cwd: os.homedir(),
      abortController: controller,
      persistSession: false,
      tools: [],
      mcpServers: {},
      // Discovery must not run project hooks or attach project MCP servers.
      settingSources: [],
      extraArgs: { "strict-mcp-config": null, "disable-slash-commands": null },
    } });
    return await Promise.race([handle.supportedModels(), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
    release();
    handle?.close();
    controller.abort();
  }
}
