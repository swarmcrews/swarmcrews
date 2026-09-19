import type { HarnessReadinessContext, HarnessReadinessProbe } from "../readiness-types.ts";
import { resolveCliRuntime, type CliRuntime } from "../cli-runtime.ts";
import { runProcess, type ProcessRunner } from "../process-runner.ts";
import { applyPiNativeMetadata, parsePiModels, setPiModels } from "./models.ts";

import { discoverPiNativeMetadata } from "./native-models.ts";

export function resolvePiRuntime(env: NodeJS.ProcessEnv = process.env): CliRuntime | null {
  return resolveCliRuntime("PI_PATH", "pi", env);
}

export async function checkPiReadiness(
  context: HarnessReadinessContext,
  deps: { resolve?: () => CliRuntime | null; run?: ProcessRunner; discover?: typeof discoverPiNativeMetadata } = {},
): Promise<HarnessReadinessProbe> {
  const runtime = (deps.resolve ?? resolvePiRuntime)();
  const source = runtime?.source ?? (process.env["PI_PATH"] ? "env_override" : "path");
  setPiModels([]);
  if (!runtime) {
    return { state: "runtime_missing", runtime: { available: false, source }, auth: { authenticated: false, source: "unknown" } };
  }
  const unavailable = (state: "probe_timeout" | "probe_failed"): HarnessReadinessProbe => ({
    state, runtime: { available: true, source }, auth: { authenticated: false, source: "unknown" },
  });
  if (context.signal.aborted) return unavailable("probe_timeout");
  try {
    // Leave room within Pi's 30s readiness budget for optional metadata.
    // Keep invoking the configured command, including package-manager wrappers.
    const catalogController = new AbortController();
    const catalogTimer = setTimeout(() => catalogController.abort(), 20_000);
    catalogTimer.unref?.();
    const result = await (deps.run ?? runProcess)(runtime.executable, ["--list-models"], {
      env: process.env,
      signal: AbortSignal.any([context.signal, catalogController.signal]),
    }).finally(() => clearTimeout(catalogTimer));
    if (context.signal.aborted || catalogController.signal.aborted) return unavailable("probe_timeout");
    const listedModels = result.code === 0 ? parsePiModels(result.stdout) : [];
    const nativeModels = listedModels.length
      ? await (deps.discover ?? discoverPiNativeMetadata)(runtime.executable, context.signal)
        .catch(() => []) // Capability enrichment is not an authentication check.
      : [];
    if (context.signal.aborted) return unavailable("probe_timeout");
    const models = applyPiNativeMetadata(listedModels, nativeModels);
    setPiModels(models);
    const ready = result.code === 0 && models.length > 0;
    return {
      state: ready ? "ready" : result.code === 0 ? "unauthenticated" : "probe_failed",
      runtime: { available: true, source },
      auth: { authenticated: ready, source: ready ? "cli_login" : "unknown" },
    };
  } catch (error) {
    return unavailable(context.signal.aborted || (error instanceof Error && error.name === "AbortError")
      ? "probe_timeout" : "probe_failed");
  }
}
