import { expect, it } from "vitest";
import { containerArguments } from "./backend.ts";
import { runnerSchema } from "./policy.ts";
const nativeIt = it.skipIf(process.platform !== "linux" || process.getuid?.() === 0);
it("uses a pinned offline rootless container with fixed suites and bounded resources, not host shell execution", () => {
  const runner = runnerSchema.parse({ id: "local", image: `localhost/browser@sha256:${"b".repeat(64)}`, grants: [] });
  const args = containerArguments({ id: "test-id", runner, suite: "smoke" }, "/tmp/snapshot");
  for (const flag of ["--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--userns=keep-id", "--pull=never", "--cgroups=enabled", "--memory=2048m", "--memory-swap=2048m", "--pids-limit=256", "--cpus=2", "--timeout=300", "--log-driver=none"]) expect(args).toContain(flag);
  // USER root in the image overrides keep-id unless the runtime pins --user.
  expect(args).toContain(`--user=${process.getuid?.() ?? 65534}:${process.getgid?.() ?? 65534}`);
  expect(args).toContain("/tmp/snapshot:/input:ro,noexec,nosuid,nodev");
  expect(args.filter(arg => arg === "--volume")).toHaveLength(1);
  expect(args.filter(arg => arg.startsWith("--tmpfs="))).toEqual([
    "--tmpfs=/tmp:rw,nosuid,nodev,size=64m,mode=1777",
    "--tmpfs=/work:rw,nosuid,nodev,size=256m,mode=1777",
    "--tmpfs=/home/runner:rw,nosuid,nodev,size=16m,mode=1777",
  ]);
  expect(args.at(-1)).toContain("exec pnpm test:smoke");
  expect(args.join(" ")).not.toMatch(/--privileged|--network=host|seccomp=unconfined|docker.sock/);
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PodmanBrowserBackend } from "./backend.ts";
import type { PodmanCommand } from "./process.ts";

nativeIt.each([0, 1, 125])("classifies exit %s and removes the container and snapshot", async exitCode => {
  const cwd = await mkdtemp(join(tmpdir(), "browser-backend-"));
  await writeFile(join(cwd, "test.js"), "test");
  const commands: string[][] = []; let snapshot = "";
  const command: PodmanCommand = async (args, output) => {
    commands.push(args);
    if (args[0] === "info") output(JSON.stringify({ host: { security: { rootless: true }, cgroupVersion: "v2", cgroupControllers: ["cpu", "memory", "pids"] } }));
    return args[0] === "start" ? exitCode : 0;
  };
  try {
    const result = await new PodmanBrowserBackend(command).execute({ id: "test", runner: runnerSchema.parse({ id: "local", image: `sha256:${"a".repeat(64)}`, grants: [] }), cwd, suite: "smoke", signal: new AbortController().signal, output: () => {}, snapshot: digest => { snapshot = digest; } });
    expect(result.exitCode).toBe(exitCode); expect(Boolean(result.infrastructureError)).toBe(exitCode === 125);
    expect(snapshot).toHaveLength(64); expect(commands.map(args => args[0])).toEqual(["info", "ps", "create", "start", "rm"]);
    expect(commands.at(-1)).toContain("swarm-browser-test");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
nativeIt("refuses leftover containers and unsupported isolation before source execution", async () => {
  const commands: string[] = [];
  const command: PodmanCommand = async (args, output) => {
    commands.push(args[0]!);
    output(args[0] === "info" ? JSON.stringify({ host: { security: { rootless: true }, cgroupVersion: "v2", cgroupControllers: ["cpu", "memory", "pids"] } }) : "orphan-id"); return 0;
  };
  const result = await new PodmanBrowserBackend(command).execute({ id: "test", runner: runnerSchema.parse({ id: "local", image: `sha256:${"a".repeat(64)}`, grants: [] }), cwd: tmpdir(), suite: "smoke", signal: new AbortController().signal, output: () => {}, snapshot: () => {} });
  expect(result.infrastructureError).toBeTruthy(); expect(commands).toEqual(["info", "ps"]);
});
nativeIt("pins the authorized directory before preflight even if an ancestor is swapped and restored", async () => {
  const { mkdir, rename, symlink, readdir } = await import("node:fs/promises");
  const base = await mkdtemp(join(tmpdir(), "browser-ancestor-swap-"));
  const parent = join(base, "approved"); const saved = join(base, "saved"); const outside = join(base, "outside");
  await mkdir(join(parent, "workspace"), { recursive: true }); await mkdir(join(outside, "workspace"), { recursive: true });
  await writeFile(join(parent, "workspace", "public.txt"), "allowed"); await writeFile(join(outside, "workspace", "private.txt"), "secret");
  let copied: string[] = [];
  const command: PodmanCommand = async (args, output) => {
    if (args[0] === "info") {
      await rename(parent, saved); await symlink(outside, parent);
      output(JSON.stringify({ host: { security: { rootless: true }, cgroupVersion: "v2", cgroupControllers: ["cpu", "memory", "pids"] } }));
    }
    if (args[0] === "create") {
      copied = await readdir(args[args.indexOf("--volume") + 1]!.split(":/input")[0]!);
      await rm(parent); await rename(saved, parent);
    }
    return 0;
  };
  try {
    const result = await new PodmanBrowserBackend(command).execute({ id: "swap", runner: runnerSchema.parse({ id: "local", image: `sha256:${"a".repeat(64)}`, grants: [] }), cwd: join(parent, "workspace"), suite: "smoke", signal: new AbortController().signal, output: () => {}, snapshot: () => {} });
    expect(result.exitCode).toBe(0); expect(copied).toEqual(["public.txt"]);
  } finally { await rm(base, { recursive: true, force: true }); }
});
nativeIt.each(["create-timeout", "rm-timeout", "rm-error", "cancel-create"] as const)("handles %s without releasing uncertain containers", async scenario => {
  const cwd = await mkdtemp(join(tmpdir(), "browser-cleanup-")); const controller = new AbortController();
  const commands: string[] = [];
  const command: PodmanCommand = async (args, output, signal) => {
    commands.push(args[0]!);
    if (args[0] === "info") output(JSON.stringify({ host: { security: { rootless: true }, cgroupVersion: "v2", cgroupControllers: ["cpu", "memory", "pids"] } }));
    if (args[0] === "create") {
      expect(signal).toBeUndefined(); // Creation settles before rm; no late-create race.
      if (scenario === "cancel-create") controller.abort();
      if (scenario === "create-timeout") return null;
    }
    if (args[0] === "rm" && scenario === "rm-timeout") return null;
    if (args[0] === "rm" && scenario === "rm-error") throw new Error("unavailable");
    return 0;
  };
  try {
    const result = await new PodmanBrowserBackend(command).execute({ id: "cleanup", runner: runnerSchema.parse({ id: "local", image: `sha256:${"a".repeat(64)}`, grants: [] }), cwd, suite: "smoke", signal: controller.signal, output: () => {}, snapshot: () => {} });
    expect(commands.at(-1)).toBe("rm");
    if (scenario === "cancel-create") { expect(commands).not.toContain("start"); expect(result.exitCode).toBeNull(); expect(result.cleanupFailed).toBeUndefined(); }
    else expect(result.cleanupFailed).toBe(true);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
nativeIt("uses operator root exclusions while preserving nested fixture inputs", async () => {
  const { mkdir, readdir } = await import("node:fs/promises");
  const cwd = await mkdtemp(join(tmpdir(), "browser-filter-plumbing-"));
  await mkdir(join(cwd, "artifacts")); await writeFile(join(cwd, "artifacts", "local-only"), "local");
  await mkdir(join(cwd, "tests", "artifacts"), { recursive: true }); await writeFile(join(cwd, "tests", "artifacts", "fixture"), "input");
  let rootEntries: string[] = []; let fixtures: string[] = [];
  const command: PodmanCommand = async (args, output) => {
    if (args[0] === "info") output(JSON.stringify({ host: { security: { rootless: true }, cgroupVersion: "v2", cgroupControllers: ["cpu", "memory", "pids"] } }));
    if (args[0] === "create") {
      const path = args[args.indexOf("--volume") + 1]!.split(":/input")[0]!;
      rootEntries = await readdir(path); fixtures = await readdir(join(path, "tests", "artifacts"));
    }
    return 0;
  };
  try {
    const result = await new PodmanBrowserBackend(command).execute({ id: "filters", runner: runnerSchema.parse({ id: "local", image: `sha256:${"a".repeat(64)}`, grants: [], sourceExclusions: ["artifacts"] }), cwd, suite: "smoke", signal: new AbortController().signal, output: () => {}, snapshot: () => {} });
    expect(result).toEqual({ exitCode: 0 }); expect(rootEntries).toEqual(["tests"]); expect(fixtures).toEqual(["fixture"]);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
