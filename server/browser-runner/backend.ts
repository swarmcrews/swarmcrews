import { runPodmanCommand, type PodmanCommand } from "./process.ts";
import type { BrowserRunner } from "./policy.ts";
import type { BrowserSuite } from "../../shared/browser-runner.ts";
import { snapshotSource } from "./snapshot.ts";
import { openSourceDirectory, type SourceDirectory } from "./directory.ts";

export interface BrowserExecution {
  id: string; runner: BrowserRunner; cwd: string; suite: BrowserSuite; signal: AbortSignal;
  output(chunk: string): void; snapshot(digest: string): void;
}
export interface BrowserExecutionResult { exitCode: number | null; infrastructureError?: string; cleanupFailed?: boolean }
export interface BrowserBackend { execute(input: BrowserExecution): Promise<BrowserExecutionResult> }

export function containerArguments(input: Pick<BrowserExecution, "id" | "runner" | "suite">, source: string): string[] {
  const { runner, suite } = input;
  // The only host mount is an immutable, filtered snapshot; no credentials, sockets or writable host paths.
  return ["create", "--name", `swarm-browser-${input.id}`, "--pull=never", "--network=none",
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--userns=keep-id",
    // Image USER (including root) must not override the invoking rootless identity.
    `--user=${process.getuid?.() ?? 65534}:${process.getgid?.() ?? 65534}`,
    "--ipc=private", "--pid=private", "--cgroups=enabled", "--log-driver=none", "--label=io.swarmcrews.browser-runner=1",
    `--timeout=${runner.timeoutSeconds}`, "--stop-timeout=2", `--memory=${runner.memoryMb}m`,
    `--memory-swap=${runner.memoryMb}m`, `--cpus=${runner.cpus}`, `--pids-limit=${runner.pids}`,
    "--ulimit=nofile=1024:1024", "--shm-size=256m", "--tmpfs=/tmp:rw,nosuid,nodev,size=64m,mode=1777",
    `--tmpfs=/work:rw,nosuid,nodev,size=${runner.workspaceMb}m,mode=1777`,
    "--tmpfs=/home/runner:rw,nosuid,nodev,size=16m,mode=1777", "--env=HOME=/home/runner", "--env=CI=1",
    "--workdir=/work", "--volume", `${source}:/input:ro,noexec,nosuid,nodev`, "--entrypoint=/bin/sh", runner.image,
    // Keep the dependency root writable in /work, not a symlink to the read-only
    // image: Vite bundles configs into node_modules/.vite-temp and optimizes into
    // node_modules/.vite. Link packages and pnpm's runtime layout only, never image
    // caches. All new config/cache files count against the existing workspace cap.
    "-c", `cp -R /input/. /work/ && mkdir /work/node_modules &&
for dependency in /opt/browser-runner/node_modules/* /opt/browser-runner/node_modules/.bin /opt/browser-runner/node_modules/.pnpm; do
  [ -e "$dependency" ] || continue
  ln -s "$dependency" /work/node_modules/ || exit 1
done && exec pnpm test:${suite}`];
}

/** Local rootless Podman only. No shell interpolation, remote daemon, auto-pull or host fallback. */
export class PodmanBrowserBackend implements BrowserBackend {
  private startup?: Promise<void>;
  constructor(private command: PodmanCommand = runPodmanCommand) {}
  private async ready(): Promise<void> {
    this.startup ??= (async () => {
      let info = "";
      const code = await this.command(["info", "--format=json"], text => { if (info.length < 65536) info += text.slice(0, 65536 - info.length); });
      if (code !== 0) throw new Error("Podman preflight failed");
      const host = JSON.parse(info).host;
      if (host?.security?.rootless !== true || host?.cgroupVersion !== "v2"
        || !["cpu", "memory", "pids"].every(c => host?.cgroupControllers?.includes(c))) throw new Error("Rootless Podman with delegated cgroup v2 controllers required");
      let orphans = "";
      const listed = await this.command(["ps", "--all", "--filter=label=io.swarmcrews.browser-runner=1", "--format={{.ID}}"], text => { orphans = (orphans + text).slice(0, 4096); });
      if (listed !== 0 || orphans.trim()) throw new Error("Managed containers remain; operator must reconcile before restarting the runner");
    })();
    return this.startup;
  }
  async execute(input: BrowserExecution): Promise<BrowserExecutionResult> {
    let source: Awaited<ReturnType<typeof snapshotSource>> | undefined;
    let root: SourceDirectory | undefined;
    let launched = false; let result: BrowserExecutionResult = { exitCode: null };
    try {
      if (process.platform !== "linux" || process.getuid?.() === 0) throw new Error("Rootless Linux runner required");
      // Pin the authorized directory synchronously, before the first async preflight.
      root = openSourceDirectory(input.cwd);
      await this.ready(); input.signal.throwIfAborted();
      source = await snapshotSource(root, input.signal, input.runner.sourceExclusions); input.snapshot(source.digest);
      input.signal.throwIfAborted(); launched = true;
      // Create must settle before cancellation can remove the container: killing `run`
      // during creation can race rm and leave a late-created orphan behind.
      const created = await this.command(containerArguments(input, source.directory), input.output);
      if (created === null) { result.cleanupFailed = true; throw new Error("Container creation timed out"); }
      if (created !== 0) throw new Error("Container creation failed");
      input.signal.throwIfAborted();
      let tail = ""; let browserFailure = false;
      const output = (text: string) => {
        tail = (tail + text).slice(-8192);
        if (/sandbox_host_linux\.cc|browserType\.launch:|Failed to launch.*browser|No usable sandbox/i.test(tail)) browserFailure = true;
        input.output(text);
      };
      const exitCode = await this.command(["start", "--attach", `swarm-browser-${input.id}`], output, input.signal, (input.runner.timeoutSeconds + 5) * 1000);
      result = { exitCode, ...((browserFailure || exitCode === null || exitCode === 125 || exitCode === 126 || exitCode === 127)
        ? { infrastructureError: "Container or browser launch failed; inspect bounded logs" } : {}) };
    } catch {
      result = { ...result, exitCode: null, infrastructureError: "Browser infrastructure failed or execution was interrupted; check Podman, policy and source snapshot requirements" };
    } finally {
      // Kill the entire container, not merely the CLI; hold the capacity lease until cleanup is confirmed.
      if (launched) {
        try {
          const code = await this.command(["rm", "--force", "--ignore", "--time=0", `swarm-browser-${input.id}`], () => {});
          if (code !== 0) result.cleanupFailed = true;
        } catch { result.cleanupFailed = true; }
      }
      try { await source?.dispose(); } catch { result.cleanupFailed = true; }
      root?.close();
    }
    return result;
  }
}
