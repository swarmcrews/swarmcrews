import { describe, expect, it, vi } from "vitest";
import { approveAll, type PermissionRequest } from "@github/copilot-sdk";
import type { HarnessStartOptions } from "../types.ts";
import { resolveHarnessSandboxPolicy } from "../sandbox-policy.ts";
import { copilotPermissionHandler } from "./permissions.ts";

const invocation = { sessionId: "permission-test" };
const read: PermissionRequest = { kind: "read", path: "/tmp/example", intention: "Inspect file" };
const write: PermissionRequest = {
  kind: "write", fileName: "/tmp/example", intention: "Update file", diff: "", canOfferSessionApproval: false,
};
const shell: PermissionRequest = {
  kind: "shell", fullCommandText: "pwd", intention: "Inspect directory", commands: [],
  canOfferSessionApproval: false, hasWriteFileRedirection: false, possiblePaths: [], possibleUrls: [],
};

function setup(overrides: Partial<HarnessStartOptions> = {}, sandboxApplied = true) {
  const controller = new AbortController();
  const emit = vi.fn();
  const handler = copilotPermissionHandler({
    sessionKey: invocation.sessionId, cwd: "/tmp", model: "test", prompt: "test", systemPrompt: "test",
    allowedTools: ["view", "glob", "grep", "bash", "edit"], abortSignal: controller.signal, ...overrides,
  }, controller.signal, emit, () => sandboxApplied);
  return { controller, emit, decide: (request: PermissionRequest) => handler(request, invocation) };
}

describe("Copilot permission decisions", () => {
  it.each([read, write, shell])("uses the SDK approval decision for $kind with unmanaged enforcement", async (request) => {
    const sandboxPolicy = resolveHarnessSandboxPolicy({ worktreeScoped: true,
      requested: { filesystemScope: "workspace-write", approvalPolicy: "on-failure" },
      support: { filesystem: [], approval: false } });
    const { decide, emit } = setup({ sandboxPolicy });
    expect(sandboxPolicy.effective).toEqual({ filesystemScope: "unmanaged", approvalPolicy: "unmanaged" });
    expect(await decide(request)).toEqual({ kind: "approve-once" });
    expect(await decide(request)).toEqual(await approveAll(request, invocation));
    expect(emit).not.toHaveBeenCalled();
  });

  it.each(["default", "plan", "acceptEdits", "bypassPermissions"] as const)("allows reads in %s mode", async (permissionMode) => {
    expect(await setup({ permissionMode }).decide(read)).toEqual({ kind: "approve-once" });
  });

  it.each([read, write, shell])("denies managed $kind approval even in bypass mode", async (request) => {
    const { decide, emit } = setup({ permissionMode: "bypassPermissions" });
    expect(await decide({ ...request, managedApprovalRequired: true })).toEqual({ kind: "user-not-available" });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: "permission_denial", tool: request.kind }));
  });

  it.each([write, shell])("denies interactive and read-only $kind requests", async (request) => {
    for (const permissionMode of ["default", "plan"] as const) {
      expect(await setup({ permissionMode }).decide(request)).toEqual({ kind: "user-not-available" });
    }
    const sandboxPolicy = resolveHarnessSandboxPolicy({ worktreeScoped: true,
      requested: { filesystemScope: "read-only", approvalPolicy: "never" } });
    expect(await setup({ sandboxPolicy, permissionMode: "bypassPermissions" }, false).decide(request))
      .toEqual({ kind: "user-not-available" });
  });

  it("honors an explicit approval policy over legacy bypass mode", async () => {
    const sandboxPolicy = resolveHarnessSandboxPolicy({ worktreeScoped: true,
      requested: { filesystemScope: "workspace-write", approvalPolicy: "on-request" } });
    expect(await setup({ sandboxPolicy, permissionMode: "bypassPermissions" }).decide(shell))
      .toEqual({ kind: "user-not-available" });
  });

  it.each([read, write, shell])("denies $kind after cancellation", async (request) => {
    const { controller, decide } = setup({ permissionMode: "bypassPermissions" });
    controller.abort();
    expect(await decide(request)).toEqual({ kind: "user-not-available" });
  });

  it.each([read, write, shell])("denies $kind sandbox bypass even with never approval", async (request) => {
    expect(await setup({ permissionMode: "bypassPermissions" }).decide({ ...request, requestSandboxBypass: true }))
      .toEqual({ kind: "user-not-available" });
  });

  it.each([write, shell])("denies $kind until the runtime sandbox is applied", async (request) => {
    expect(await setup({ permissionMode: "bypassPermissions" }, false).decide(request))
      .toEqual({ kind: "user-not-available" });
  });

  it("allows registered application tools to report in read-only mode", async () => {
    const { decide } = setup({ permissionMode: "plan", allowedTools: ["mcp__minion-status__report_done"] });
    const request: PermissionRequest = { kind: "custom-tool", toolName: "mcp__minion-status__report_done", toolDescription: "Report" };
    expect(await decide(request)).toEqual({ kind: "approve-once" });
    expect(await decide({ ...request, toolName: "mcp__unknown__mutate" })).toEqual({ kind: "user-not-available" });
    expect(await decide({ ...request, managedApprovalRequired: true })).toEqual({ kind: "user-not-available" });
  });
});
