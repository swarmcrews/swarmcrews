import { spawn } from "node:child_process";

export type PodmanCommand = (args: string[], output: (text: string) => void, signal?: AbortSignal, timeoutMs?: number) => Promise<number | null>;
export const runPodmanCommand: PodmanCommand = (args, output, signal, timeoutMs = 15000) => new Promise((resolve, reject) => {
  signal?.throwIfAborted();
  const env: NodeJS.ProcessEnv = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" };
  for (const key of ["HOME", "XDG_RUNTIME_DIR", "USER", "LOGNAME"]) if (process.env[key]) env[key] = process.env[key];
  const child = spawn("/usr/bin/podman", ["--remote=false", ...args], { env, stdio: ["ignore", "pipe", "pipe"], shell: false });
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = (code: number | null, error?: Error) => {
    if (settled) return;
    settled = true; clearTimeout(timer); signal?.removeEventListener("abort", stop);
    child.stdout.destroy(); child.stderr.destroy();
    if (error) reject(error); else resolve(code);
  };
  // Do not await `close`: inherited pipes can stay open after the CLI is dead.
  // Null exit is explicitly uncertain; the backend must still remove/quarantine the container.
  const stop = () => { child.kill("SIGKILL"); settle(null); };
  child.stdout.setEncoding("utf8").on("data", output); child.stderr.setEncoding("utf8").on("data", output);
  child.once("error", error => settle(null, error)); child.once("close", code => settle(code));
  timer = setTimeout(stop, timeoutMs); timer.unref();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
});
