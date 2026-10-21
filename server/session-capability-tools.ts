import type { AgentTypeContext, AgentToolResult } from "./agents/types.ts";
import { installConnectionTools } from "./mcp-connections/tools.ts";
import { installBrowserRunnerTools } from "./browser-runner/tools.ts";

/** Shared capabilities are registered once across harnesses; existing allowlist filtering still applies. */
export function installSessionCapabilityTools(ctx: AgentTypeContext, result: AgentToolResult, signal: AbortSignal, inspectionOnly = false, canConfigure = false): () => Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  installBrowserRunnerTools(ctx, result, controller.signal, inspectionOnly);
  const closeConnections = installConnectionTools(ctx, result, controller.signal, inspectionOnly, canConfigure);
  return async () => { controller.abort(); signal.removeEventListener("abort", abort); await closeConnections(); };
}
