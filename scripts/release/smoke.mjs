#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { waitForOutput, stopTestProcess } from "../test-process.mjs";
import { isProviderPackage } from "./config.mjs";
import { commandSpec } from "./command.mjs";

const archive = resolve(process.argv[2]);
const expected = readFileSync(`${archive}.sha256`, "utf8").split(/\s+/)[0];
assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), expected);
const scratch = mkdtempSync(join(tmpdir(), "swarmcrews portable "));
let child;
let ws;
try {
  execFileSync("tar", ["-xf", archive, "-C", scratch], { timeout: 120_000 });
  const names = readdirSync(scratch);
  assert.equal(names.length, 1);
  const app = join(scratch, names[0]);
  const manifest = JSON.parse(readFileSync(join(app, "release.json")));
  assert.equal(manifest.target, `${process.platform}-${process.arch}`);
  const inventory = JSON.parse(readFileSync(join(app, "dependency-inventory.json")));
  assert.ok(inventory.length > 0);
  assert.equal(inventory.some(pkg => isProviderPackage(pkg.name)), false);
  for (const path of ["src", ".git", ".env", "server/index.ts", "node_modules/tsx", "node_modules/vite", "node_modules/typescript", "node_modules/@anthropic-ai", "node_modules/@openai", "node_modules/@github"]) {
    assert.equal(existsSync(join(app, path)), false, `Unexpected packaged path: ${path}`);
  }
  assert.ok(readFileSync(join(app, "runtime/LICENSE"), "utf8").includes("Node.js"));
  const node = join(app, "runtime", process.platform === "win32" ? "node.exe" : "node");
  assert.equal(execFileSync(node, ["--version"], { encoding: "utf8" }).trim(), `v${manifest.nodeVersion}`);
  const home = join(scratch, "home"); mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    SWARMCREWS_HOME: join(home, ".swarmcrews"), NODE_PATH: "", NODE_OPTIONS: "", PATH: "", Path: "" };
  for (const key of Object.keys(env)) {
    if (/^(?:CLAUDE|CODEX|COPILOT|OPENCODE|PI_|ANTHROPIC|OPENAI|MINIONS|SWARMCREWS_TEST|VITE_)/.test(key) || key === "HOST") delete env[key];
  }
  const versionOptions = { cwd: home, env, encoding: "utf8", timeout: 10_000 };
  const versionCommand = commandSpec(join(app, process.platform === "win32" ? "swarmcrews.cmd" : "swarmcrews"), ["--version"]);
  const version = execFileSync(versionCommand.command, versionCommand.args, { ...versionOptions, ...versionCommand.options });
  assert.equal(version.trim(), `Swarmcrews ${manifest.version} (${manifest.target})`);
  // Native SQLite is exercised by the bundled Node, not the build host Node.
  execFileSync(node, ["--input-type=module", "-e", 'import Database from "better-sqlite3"; const db = new Database(process.env.SWARMCREWS_HOME + "-smoke.db"); db.exec("CREATE TABLE smoke (value TEXT)"); db.prepare("INSERT INTO smoke VALUES (?)").run("portable"); if (db.prepare("SELECT value FROM smoke").get().value !== "portable") throw Error("SQLite failed"); db.close();'], { cwd: app, env, stdio: "inherit", timeout: 30_000 });
  const reserve = createServer(); reserve.listen(0, "127.0.0.1"); await once(reserve, "listening");
  env.PORT = String(reserve.address().port); await new Promise(done => reserve.close(done));
  child = spawn(node, [join(app, "swarmcrews.mjs")], { cwd: home, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  await waitForOutput(child, "listening", { timeoutMs: 30_000 });
  const base = `http://127.0.0.1:${env.PORT}`;
  const get = (url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(10_000) });
  const ui = await get("/"); assert.equal(ui.status, 200); assert.equal(ui.headers.get("x-frame-options"), "DENY");
  const html = await ui.text(); assert.match(html, /<html/);
  const script = html.match(/src="(\/assets\/[^" ]+\.js)"/); assert.ok(script);
  const asset = await get(script[1]); assert.equal(asset.status, 200); assert.match(asset.headers.get("content-type"), /javascript/);
  assert.equal((await get("/m")).status, 200);
  assert.equal((await get("/api/projects")).status, 401);
  assert.equal((await get("/api/auth/token", { headers: { Origin: "https://attacker.example" } })).status, 403);
  const { token } = await (await get("/api/auth/token")).json(); assert.equal(typeof token, "string");
  const headers = { Authorization: `Bearer ${token}` };
  const readiness = await (await get("/api/readiness", { headers })).json();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.harnesses.length, 5);
  for (const harness of readiness.harnesses) assert.equal(harness.state, "runtime_missing", harness.name);
  // Resolve ws from the extracted app, ensuring its production dependency is present.
  const require = createRequire(join(app, "package.json"));
  const WebSocket = require("ws");
  ws = new WebSocket(`ws://127.0.0.1:${env.PORT}/ws?token=${token}`, { origin: base });
  await Promise.race([once(ws, "open"), new Promise((_, reject) => { const t = setTimeout(() => reject(Error("WebSocket timeout")), 10_000); t.unref(); })]);
  ws.close(); await once(ws, "close"); ws = undefined;
  const exited = once(child, "exit"); child.send("shutdown");
  await Promise.race([exited, new Promise((_, reject) => { const t = setTimeout(() => reject(Error("Shutdown timeout")), 15_000); t.unref(); })]);
  assert.equal(child.exitCode, 0);
  await assert.rejects(get("/"));
  console.log(`PASS extracted ${manifest.target}: UI, auth, WebSocket, SQLite, no harnesses, shutdown`);
} finally {
  ws?.terminate();
  if (child) await stopTestProcess(child);
  rmSync(scratch, { recursive: true, force: true });
}
