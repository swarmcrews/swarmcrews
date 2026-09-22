#!/usr/bin/env node
// Launches Swarmcrews (server + vite) detached in the background and returns to
// the terminal after a short early-failure check. Startup errors are shown inline;
// ongoing logs are redirected to a file.
//   pnpm start          start in background
//   pnpm start stop     stop the background service
//   pnpm start restart  restart the background service
//   pnpm start status   report whether it is running
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDependencies } from "./check-dependencies.mjs";
import { observeStartup, releaseStartupObserver } from "./startup-observer.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");
const runDir = join(root, ".run");
const legacyPidFile = join(runDir, "minions.pid");
// Adopt a live legacy launcher so status/stop/restart retain process ownership.
const currentPidFile = join(runDir, "swarmcrews.pid");
const useLegacy = !isRunning(readPidAt(currentPidFile)) && isRunning(readPidAt(legacyPidFile));
let pidFile = useLegacy ? legacyPidFile : join(runDir, "swarmcrews.pid");
let logFile = join(runDir, useLegacy ? "minions.log" : "swarmcrews.log");
const tailscaleFile = join(runDir, "tailscale.enabled");
const isWin = process.platform === "win32";
const vitePort = process.env["VITE_PORT"] ?? "6173";

const action = process.argv[2] ?? "start";
const tailscale = process.argv.includes("--tailscale");

switch (action) {
  case "stop":
    stop();
    break;
  case "status":
    status();
    break;
  case "restart":
    await restart();
    break;
  case "start":
    await start();
    break;
  default:
    console.error(`Unknown action "${action}". Use start, stop, restart, or status.`);
    process.exit(1);
}

function readPidAt(file) {
  if (!existsSync(file)) return null;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function readPid() {
  return readPidAt(pidFile);
}

function isRunning(pid) {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still running.
    return err.code === "EPERM";
  }
}

function rel(p) {
  return relative(process.cwd(), p) || p;
}

async function start(enableTail = tailscale) {
  const existing = readPid();
  if (isRunning(existing)) {
    console.log(`Swarmcrews is already running (pid ${existing}).`);
    if (enableTail) {
      enableTailscaleServe();
      mkdirSync(runDir, { recursive: true });
      writeFileSync(tailscaleFile, vitePort);
    }
    console.log(`  logs: ${rel(logFile)}`);
    console.log(`  stop: pnpm stop`);
    return;
  }

  pidFile = join(runDir, "swarmcrews.pid");
  logFile = join(runDir, "swarmcrews.log");
  checkDependencies(["tsx", "vite", "better-sqlite3"]);
  mkdirSync(runDir, { recursive: true });
  const child = spawn(process.execPath, [join(scriptDir, "run.mjs"), "dev"], {
    cwd: root,
    detached: true,
    // The runner owns rotation; inherited append descriptors bypass its bound.
    // Pipes catch bootstrap errors before logging is initialized; IPC carries
    // service failure diagnostics without reading stale/rotated log files.
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, SWARMCREWS_LAUNCH_LOG: logFile },
    shell: false,
    windowsHide: true,
  });

  const startup = observeStartup(child);
  if (child.pid) writeFileSync(pidFile, String(child.pid));
  try {
    await startup;
  } catch (error) {
    console.error(`Swarmcrews failed to start: ${error.message}`);
    console.error(`  logs: ${rel(logFile)}`);
    // Preserve ownership if a failed runner has not finished cleaning up yet.
    if (!isRunning(child.pid) && readPid() === child.pid) rmSync(pidFile, { force: true });
    process.exitCode = 1;
    return;
  } finally {
    releaseStartupObserver(child);
  }

  if (enableTail) {
    try {
      enableTailscaleServe();
    } catch {
      try { process.kill(isWin ? child.pid : -child.pid, "SIGTERM"); } catch {}
      if (existsSync(pidFile)) rmSync(pidFile);
      process.exit(1);
    }
    writeFileSync(tailscaleFile, vitePort);
  }

  console.log(`Swarmcrews started in background (pid ${child.pid}).`);
  console.log(`  logs:   ${rel(logFile)}`);
  console.log(`  status: pnpm status`);
  console.log(`  stop:   pnpm stop`);
}

function stop() {
  const pid = readPid();
  if (!isRunning(pid)) {
    console.log("Swarmcrews is not running.");
    if (existsSync(pidFile)) rmSync(pidFile);
    if (existsSync(tailscaleFile)) {
      disableTailscaleServe();
      rmSync(tailscaleFile, { force: true });
    }
    return;
  }

  try {
    if (isWin) {
      const result = spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true, timeout: 5_000,
      });
      if (result.error || result.status !== 0) throw result.error ?? new Error("Could not stop the launcher tree");
    } else {
      // The detached child is a process-group leader; signal the whole group
      // so the server and vite children go down with it.
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between the group and individual signals.
    }
  }

  const deadline = Date.now() + 5_000;
  while (isRunning(pid) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  if (isRunning(pid)) {
    throw new Error(`Swarmcrews (pid ${pid}) did not stop; preserving its ownership record.`);
  }
  if (existsSync(pidFile)) rmSync(pidFile);
  if (existsSync(tailscaleFile)) {
    disableTailscaleServe();
    rmSync(tailscaleFile, { force: true });
  }
  console.log(`Swarmcrews stopped (pid ${pid}).`);
}

async function restart() {
  checkDependencies(["tsx", "vite", "better-sqlite3"]);
  const restoreTailscale = tailscale || existsSync(tailscaleFile);
  const pid = readPid();
  if (isRunning(pid)) {
    stop();
    const deadline = Date.now() + 3000;
    while (isRunning(pid) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  } else if (existsSync(pidFile)) {
    rmSync(pidFile);
  }
  await start(restoreTailscale);
}

function status() {
  const pid = readPid();
  if (isRunning(pid)) {
    console.log(`Swarmcrews is running (pid ${pid}).`);
    console.log(`  logs: ${rel(logFile)}`);
    if (existsSync(tailscaleFile)) showTailscaleServeStatus();
  } else {
    console.log("Swarmcrews is not running.");
  }
}

function runTailscaleServe(args, stdio = "inherit") {
  return spawnSync(process.execPath, [join(scriptDir, "tailscale-serve.mjs"), ...args], {
    cwd: root,
    stdio,
    shell: false,
    windowsHide: true,
  });
}

function enableTailscaleServe() {
  const result = runTailscaleServe(["--port", vitePort]);
  if (result.status !== 0) {
    console.error("\nSwarmcrews was not started because Tailscale HTTPS serving could not be configured.");
    throw new Error("Tailscale configuration failed");
  }
}

function disableTailscaleServe() {
  const result = runTailscaleServe(["--port", vitePort, "--off"]);
  if (result.status !== 0) {
    console.error("Warning: failed to tear down Tailscale serve config.");
  }
}

function showTailscaleServeStatus() {
  runTailscaleServe(["--status"]);
}
