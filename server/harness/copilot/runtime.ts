import type { CopilotClient } from "@github/copilot-sdk";
import { resolveCliRuntime, type CliRuntime } from "../cli-runtime.ts";
import type { HarnessReadinessContext, HarnessReadinessProbe } from "../readiness-types.ts";
import { selectableCopilotModels, setCopilotModels } from "./models.ts";

export function resolveCopilotRuntime(env: NodeJS.ProcessEnv = process.env): CliRuntime | null {
  return resolveCliRuntime("COPILOT_CLI_PATH", "copilot", env);
}

/** Lazy loading keeps a missing SDK from breaking other harnesses at startup. */
export async function createCopilotClient(runtime: CliRuntime, cwd?: string): Promise<CopilotClient> {
  const { CopilotClient, RuntimeConnection } = await import("@github/copilot-sdk");
  return new CopilotClient({
    connection: RuntimeConnection.forStdio({ path: runtime.executable }),
    ...(cwd ? { workingDirectory: cwd } : {}),
    logLevel: "error",
  });
}

export async function checkCopilotReadiness(
  { signal }: HarnessReadinessContext,
  deps: { resolve?: () => CliRuntime | null; create?: typeof createCopilotClient } = {},
): Promise<HarnessReadinessProbe> {
  const runtime = (deps.resolve ?? resolveCopilotRuntime)();
  const source = runtime?.source ?? (process.env["COPILOT_CLI_PATH"] ? "env_override" : "path");
  setCopilotModels([]);
  if (!runtime) return { state: "runtime_missing", runtime: { available: false, source }, auth: { authenticated: false, source: "unknown" } };
  let client: CopilotClient | undefined;
  let version: string | undefined;
  let auth: HarnessReadinessProbe["auth"] = { authenticated: false, source: "unknown" };
  const abort = () => { void client?.forceStop().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    client = await (deps.create ?? createCopilotClient)(runtime);
    signal.throwIfAborted();
    await client.start();
    const [status, authentication] = await Promise.all([client.getStatus(), client.getAuthStatus()]);
    version = status.version;
    auth = { authenticated: authentication.isAuthenticated,
      source: authentication.authType === "api-key" ? "api_key"
        : authentication.authType === "user" || authentication.authType === "gh-cli" ? "cli_login" : "unknown" };
    if (!auth.authenticated) return { state: "unauthenticated", runtime: { available: true, source, version }, auth };
    const models = await client.listModels();
    signal.throwIfAborted();
    setCopilotModels(models);
    return { state: selectableCopilotModels().length ? "ready" : "probe_failed", runtime: { available: true, source, version }, auth };
  } catch {
    setCopilotModels([]);
    return { state: signal.aborted ? "probe_timeout" : "probe_failed", runtime: { available: true, source, ...(version ? { version } : {}) }, auth };
  } finally {
    signal.removeEventListener("abort", abort);
    // Probes own no persistent session. Force shutdown also bounds failed RPC cleanup.
    await client?.forceStop().catch(() => {});
  }
}
