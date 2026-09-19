import { spawn } from "node:child_process";
import type { PiNativeModelMetadata } from "./models.ts";

/** Query the configured CLI itself: wrappers, alternate installs and models.json
 * must use the same catalog as the process we actually launch. No prompt is sent. */
export function discoverPiNativeMetadata(executable: string, signal: AbortSignal): Promise<PiNativeModelMetadata[]> {
  if (signal.aborted) return Promise.resolve([]);
  return new Promise(resolve => {
    const child = spawn(executable, ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-tools"], {
      env: { ...process.env, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
      detached: process.platform !== "win32",
    });
    let models: PiNativeModelMetadata[] = [];
    let buffer = "";
    let bytes = 0;
    let stopped = false;
    let finished = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.stdin.end();
      // Wrappers can have npm/CLI descendants holding the output pipe open.
      // Stop the owned process group, and settle without waiting for pipe EOF.
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { child.kill("SIGKILL"); }
      child.stdout.destroy();
      finish();
    };
    const timeout = setTimeout(stop, 8_000);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", stop);
      resolve(models);
    };
    signal.addEventListener("abort", stop, { once: true });
    child.on("error", finish);
    child.on("close", finish);
    child.stdin.on("error", stop);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1_048_576) { stop(); return; }
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const response = JSON.parse(line) as { type?: string; id?: string; success?: boolean; data?: { models?: unknown } };
          if (response.type !== "response" || response.id !== "swarmcrews-models") continue;
          if (response.success && Array.isArray(response.data?.models)) {
            // Return only capability data, never provider headers or credentials.
            models = response.data.models.flatMap((model: unknown) => {
              if (!model || typeof model !== "object") return [];
              const value = model as Record<string, unknown>;
              if (typeof value.provider !== "string" || typeof value.id !== "string" || typeof value.reasoning !== "boolean") return [];
              const thinkingLevelMap: PiNativeModelMetadata["thinkingLevelMap"] = {};
              if (value.thinkingLevelMap && typeof value.thinkingLevelMap === "object") {
                for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
                  const mapped = (value.thinkingLevelMap as Record<string, unknown>)[level];
                  if (typeof mapped === "string" || mapped === null) thinkingLevelMap[level] = mapped;
                }
              }
              return [{ provider: value.provider, id: value.id, reasoning: value.reasoning, thinkingLevelMap }];
            });
          }
          stop();
          return;
        } catch { /* Startup notices are not RPC responses. */ }
      }
    });
    if (signal.aborted) stop();
    else child.stdin.write(`${JSON.stringify({ id: "swarmcrews-models", type: "get_available_models" })}\n`);
  });
}
