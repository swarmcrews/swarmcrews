import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { HarnessStartOptions } from "../types.ts";
import { copilotSandboxConfig, copilotSandboxHooks, copilotWriteAllowed } from "./sandbox.ts";

let root: string;
let opts: HarnessStartOptions;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "copilot-policy-"));
  const cwd = path.join(root, "repo"); mkdirSync(cwd); mkdirSync(path.join(cwd, ".git"));
  opts = { cwd, sessionKey: "test", model: "test", prompt: "test", systemPrompt: "test",
    allowedTools: ["view", "create", "edit", "bash"], abortSignal: new AbortController().signal };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("Copilot sandbox", () => {
  it("grants only the real workspace writes and protects Git metadata", () => {
    expect(copilotSandboxConfig(opts)).toMatchObject({ enabled: true, allowBypass: false,
      addCurrentWorkingDirectory: false, allowDevToolAccess: false, sandboxMcpServers: true,
      sandboxLspServers: true, userPolicy: { filesystem: { readwritePaths: [opts.cwd],
        readonlyPaths: expect.arrayContaining([path.join(opts.cwd, ".git")]) } } });
    expect(copilotWriteAllowed(opts, "src/new/file.ts")).toBe(true);
    for (const file of ["../outside", ".git/config", ".agents/rules", ".codex/config", "", null]) {
      expect(copilotWriteAllowed(opts, file)).toBe(false);
    }
  });

  it("rejects symlink escapes, including missing targets and children", () => {
    mkdirSync(path.join(root, "outside"));
    symlinkSync(path.join(root, "outside"), path.join(opts.cwd, "link"));
    symlinkSync(path.join(root, "missing"), path.join(opts.cwd, "dangling"));
    for (const file of ["link/new/file", "link/../escaped", "dangling", "dangling/new/file"]) {
      expect(copilotWriteAllowed(opts, file)).toBe(false);
    }
    writeFileSync(path.join(opts.cwd, "actual"), "old");
    symlinkSync(path.join(opts.cwd, "actual"), path.join(opts.cwd, "internal"));
    expect(copilotWriteAllowed(opts, "internal")).toBe(true);
  });

  it("uses legacy plan mode only when no explicit filesystem policy exists", () => {
    opts.permissionMode = "plan";
    expect(copilotSandboxConfig(opts).userPolicy?.filesystem?.readwritePaths).toEqual([]);
    expect(copilotWriteAllowed(opts, "file")).toBe(false);
    opts.sandboxPolicy = { requested: { filesystemScope: "workspace-write", approvalPolicy: "never" },
      effective: { filesystemScope: "workspace-write", approvalPolicy: "never" }, unsupported: [] };
    expect(copilotWriteAllowed(opts, "file")).toBe(true);
    expect(copilotSandboxConfig(opts).userPolicy?.filesystem?.readwritePaths).toEqual([opts.cwd]);
  });

  it("disables the native sandbox only for an explicit unrestricted policy", () => {
    opts.sandboxPolicy = { requested: { filesystemScope: "unrestricted", approvalPolicy: "never" },
      effective: { filesystemScope: "unrestricted", approvalPolicy: "never" }, unsupported: [] };
    expect(copilotSandboxConfig(opts)).toEqual({ enabled: false });
    expect(copilotWriteAllowed(opts, path.join(root, "outside"))).toBe(true);
  });

  it("blocks native edits before execution without overriding ordinary approval for allowed edits", async () => {
    const controller = new AbortController();
    const pre = copilotSandboxHooks(opts, controller.signal).onPreToolUse!;
    const input = { sessionId: "test", timestamp: new Date(), workingDirectory: opts.cwd,
      toolName: "edit", toolArgs: { path: "../outside" } };
    expect(await pre(input, { sessionId: "test" })).toMatchObject({ permissionDecision: "deny" });
    input.toolArgs.path = "file";
    expect(await pre(input, { sessionId: "test" })).toBeUndefined();
    opts.permissionMode = "plan";
    expect(await pre(input, { sessionId: "test" })).toMatchObject({ permissionDecision: "deny" });
    controller.abort(); input.toolName = "bash";
    expect(await pre(input, { sessionId: "test" })).toMatchObject({ permissionDecision: "deny" });
  });
});
