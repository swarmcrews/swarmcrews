#!/usr/bin/env node
// Copied into the portable archive; Node built-ins and our supervisor only.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { killOwnedProcess } from "./shared/owned-processes.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "release.json"), "utf8"));
const command = process.argv[2] ?? "start";
if (!["start", "--version"].includes(command) || process.argv.length > 3) {
  console.error("Usage: swarmcrews [start|--version]\nRuns in the foreground. Press Ctrl-C to stop.");
  process.exitCode = 1;
} else if (command === "--version") {
  console.log(`Swarmcrews ${manifest.version} (${manifest.target})`);
} else {
  if (`${process.platform}-${process.arch}` !== manifest.target || process.versions.node !== manifest.nodeVersion) {
    throw new Error("Wrong Node runtime or platform. Use the swarmcrews launcher shipped in this archive.");
  }
  const env = { ...process.env, SWARMCREWS_PACKAGED: "1", NODE_ENV: "production", PORT: process.env.PORT ?? "6173" };
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
  const inheritedPath = env[pathKey] ?? "";
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env[process.platform === "win32" ? "Path" : "PATH"] = `${join(root, "runtime")}${delimiter}${inheritedPath}`;
  let child;
  let stopping = false;
  let finished = false;
  let deadline;
  const restarts = [];
  const owned = new Map();
  let acknowledged;
  function cleanup() {
    let failed = false;
    for (const [pid, detached] of owned) {
      try { killOwnedProcess(pid, detached); } catch (error) { console.error(error.message); failed = true; }
    }
    owned.clear();
    if (child?.pid) {
      try { killOwnedProcess(child.pid, process.platform !== "win32"); } catch (error) { console.error(error.message); failed = true; }
    }
    return !failed;
  }
  function stop() {
    if (stopping || finished) return;
    stopping = true;
    if (child?.connected) child.send("shutdown", () => {});
    else { acknowledged = 1; cleanup(); }
    deadline = setTimeout(() => {
      console.error("Backend shutdown did not drain before its deadline; forcing owned process cleanup.");
      acknowledged = 1; if (!cleanup()) process.exit(1);
    }, 12_000);
  }
  process.on("SIGINT", stop); process.on("SIGTERM", stop); process.on("disconnect", stop);
  process.on("message", message => { if (message === "shutdown") stop(); });
  function launch() {
    acknowledged = undefined;
    child = spawn(process.execPath, [join(root, "server", "index.js")], {
      env, detached: process.platform !== "win32", stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true,
    });
    child.on("message", message => {
      if (message?.type === "owned-process" && Number.isSafeInteger(message.pid) && message.pid > 0 && message.pid !== process.pid && message.pid !== child.pid) {
        owned.set(message.pid, message.detached === true);
      } else if (message?.type === "released-process") {
        owned.delete(message.pid);
      } else if (message?.type === "shutdown-ready" && [0, 1, 42].includes(message.code) && acknowledged === undefined) {
        acknowledged = message.code;
        if (!cleanup()) { acknowledged = 1; process.exit(1); }
      }
    });
    child.once("error", error => { finished = true; clearTimeout(deadline); console.error(error.message); process.exitCode = 1; if (process.connected) process.disconnect(); });
    child.once("exit", code => {
      clearTimeout(deadline);
      const cleaned = cleanup();
      const result = cleaned ? (acknowledged ?? (code && code !== 42 ? code : 1)) : 1;
      if (!stopping && result === 42) {
        const now = Date.now(); restarts.push(now);
        while (restarts[0] < now - 60_000) restarts.shift();
        if (restarts.length <= 3) { launch(); return; }
        console.error("Too many restart requests; stopping.");
      }
      finished = true;
      process.exitCode = result === 42 ? (stopping ? 0 : 1) : result;
      if (process.connected) process.disconnect();
    });
  }
  launch();
}
