import * as os from "node:os";
import { allowedCodexEnv } from "./env.ts";
import { spawn } from "node:child_process";
import type { CodexRuntime } from "./runtime.ts";

/** The exec SDK has no catalog API. Use the configured CLI's app-server
 * handshake and paginated model/list, without creating a thread or turn. */
export function discoverCodexModels(runtime: CodexRuntime, signal: AbortSignal): Promise<unknown[]> {
  if (signal.aborted) return Promise.reject(new Error("Codex model discovery aborted"));
  return new Promise((resolve, reject) => {
    const env = allowedCodexEnv(runtime.env);
    // The SDK normally injects its resolved apiKey separately from env.
    if (runtime.env["CODEX_API_KEY"]) env["CODEX_API_KEY"] = runtime.env["CODEX_API_KEY"];
    const child = spawn(runtime.executable, ["app-server", "--listen", "stdio://"], {
      env, cwd: os.homedir(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
      detached: process.platform !== "win32",
    });
    let settled = false;
    let buffer = "";
    let bytes = 0;
    let id = 0;
    const models: unknown[] = [];
    const cursors = new Set<string>();
    const finish = (success = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      child.stdin.destroy();
      child.stdout.destroy();
      // Also terminate descendants of user-configured wrapper executables.
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch { child.kill("SIGKILL"); }
      if (success) resolve(models);
      else reject(new Error("Codex model discovery failed"));
    };
    const abort = () => finish();
    const timer = setTimeout(abort, 10_000);
    signal.addEventListener("abort", abort, { once: true });
    child.on("error", abort);
    child.on("close", abort);
    child.stdin.on("error", abort);
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const list = (cursor?: string) => send({ id: ++id, method: "model/list", params: { includeHidden: false, limit: 100, ...(cursor ? { cursor } : {}) } });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1_048_576) { finish(); return; }
      buffer += chunk;
      let newline: number;
      while (!settled && (newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let response: { id?: unknown; result?: { data?: unknown; nextCursor?: unknown }; error?: unknown };
        try { response = JSON.parse(line); } catch { continue; }
        if (!response || response.id !== id) continue;
        if (response.error || !response.result) { finish(); return; }
        if (id === 0) {
          send({ method: "initialized" });
          list();
          continue;
        }
        if (!Array.isArray(response.result.data)) { finish(); return; }
        models.push(...response.result.data);
        const cursor = response.result.nextCursor;
        if (cursor == null) { finish(true); return; }
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor) || cursors.size >= 100) { finish(); return; }
        cursors.add(cursor);
        list(cursor);
      }
    });
    if (signal.aborted) finish();
    else send({ id, method: "initialize", params: {
      clientInfo: { name: "swarmcrews_model_discovery", version: "1.0.0" },
      capabilities: null,
    } });
  });
}
