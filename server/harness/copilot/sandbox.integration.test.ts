import { afterEach, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CopilotClient, RuntimeConnection, type CopilotSession, type SessionConfig } from "@github/copilot-sdk";
import type { HarnessStartOptions } from "../types.ts";
import { resolveCopilotRuntime } from "./runtime.ts";
import { applyCopilotSandbox, copilotSandboxHooks } from "./sandbox.ts";
import { copilotPermissionHandler } from "./permissions.ts";

// Opt in on a host with the Copilot CLI and its native sandbox prerequisites.
// No model request, GitHub authentication, or paid inference is used.
// Keep the fixture outside the system temp directory: provider scratch storage
// is intentionally writable, even under a workspace filesystem policy.
let client: CopilotClient | undefined;
let root: string | undefined;
afterEach(async () => {
  await client?.forceStop(); client = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

it.skipIf(process.env["COPILOT_SANDBOX_INTEGRATION"] !== "1")(
  "enforces file and shell writes through the real Copilot runtime, including cold resume", async () => {
    const runtime = resolveCopilotRuntime();
    if (!runtime) throw new Error("Copilot CLI is required for the native sandbox integration test.");
    const fixtures = path.join(process.cwd(), "node_modules", ".tmp"); mkdirSync(fixtures, { recursive: true });
    root = mkdtempSync(path.join(fixtures, "copilot-native-"));
    const cwd = path.join(root, "workspace"); mkdirSync(cwd);
    const outside = path.join(root, "outside"); mkdirSync(outside);
    writeFileSync(path.join(cwd, "input"), "input");
    symlinkSync(outside, path.join(cwd, "escape"), "dir");
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const newClient = () => new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: runtime.executable,
        env: { ...env, COPILOT_HOME: path.join(root!, "state"), XDG_CACHE_HOME: path.join(root!, "cache") } }),
      workingDirectory: cwd, mode: "empty", baseDirectory: path.join(root!, "sessions"), logLevel: "error",
    });
    client = newClient();
    const opts: HarnessStartOptions = { cwd, sessionKey: "native-test", model: "test", prompt: "unused",
      systemPrompt: "unused", allowedTools: ["view", "create", "edit", "bash"],
      abortSignal: new AbortController().signal, permissionMode: "bypassPermissions",
      sandboxPolicy: { requested: { filesystemScope: "read-only", approvalPolicy: "never" },
        effective: { filesystemScope: "read-only", approvalPolicy: "never" }, unsupported: [] } };
    let applied = false;
    const config: SessionConfig = { model: "test", workingDirectory: cwd,
      provider: { type: "openai", baseUrl: "http://127.0.0.1:1", apiKey: "unused" },
      availableTools: opts.allowedTools.map(name => `builtin:${name}`),
      hooks: copilotSandboxHooks(opts, opts.abortSignal),
      onPermissionRequest: copilotPermissionHandler(opts, opts.abortSignal, () => {}, () => applied) };
    const shell = (session: CopilotSession, command: string) => session.rpc.tools.execute({
      name: "bash", arguments: { command, description: "Sandbox boundary verification", mode: "sync" },
    });
    await client.start();
    let session = await client.createSession(config);
    await applyCopilotSandbox(session, opts); applied = true;
    expect(JSON.stringify(await shell(session, "cat input"))).toContain("input");
    await shell(session, "printf forbidden > blocked");
    expect(existsSync(path.join(cwd, "blocked"))).toBe(false);
    await session.rpc.tools.execute({ name: "create", arguments: { path: path.join(cwd, "blocked"), file_text: "forbidden" } });
    expect(existsSync(path.join(cwd, "blocked"))).toBe(false);

    const id = session.sessionId;
    await client.forceStop(); client = newClient(); await client.start(); applied = false;
    opts.sandboxPolicy!.requested.filesystemScope = "workspace-write";
    session = await client.resumeSession(id, config);
    await applyCopilotSandbox(session, opts); applied = true;
    await shell(session, "printf allowed > allowed");
    expect(readFileSync(path.join(cwd, "allowed"), "utf8")).toBe("allowed");
    await session.rpc.tools.execute({ name: "create", arguments: { path: path.join(cwd, "file-tool"), file_text: "allowed" } });
    expect(readFileSync(path.join(cwd, "file-tool"), "utf8")).toBe("allowed");
    await shell(session, `printf forbidden > ${quote(path.join(outside, "blocked"))}`);
    await shell(session, "printf forbidden > escape/symlink-write");
    await session.rpc.tools.execute({ name: "create", arguments: { path: path.join(cwd, "escape", "file-tool"), file_text: "forbidden" } });
    for (const file of ["blocked", "symlink-write", "file-tool"]) expect(existsSync(path.join(outside, file))).toBe(false);
  }, 30_000,
);
