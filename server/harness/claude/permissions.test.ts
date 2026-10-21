import { describe, it, expect, vi } from "vitest";
import { claudePermissionHandler } from "./permissions.ts";
import type { HarnessStartOptions } from "../types.ts";

function setup() {
  const controller = new AbortController();
  const requestToolApproval = vi.fn<HarnessStartOptions["requestToolApproval"] & {}>().mockResolvedValue("allow_once");
  const opts: HarnessStartOptions = { sessionKey: "claude", cwd: "/tmp", model: "test", prompt: "", systemPrompt: "",
    allowedTools: ["Bash"], abortSignal: controller.signal, requestToolApproval };
  const context = { signal: controller.signal, toolUseID: "tool-1", requestId: "native-1" };
  return { opts, context, controller, requestToolApproval };
}
describe("Claude native approvals", () => {
  it("cannot approve a tool outside the invocation allowlist", async () => {
    const f = setup(); f.opts.allowedTools = ["Read"];
    expect(await claudePermissionHandler(f.opts)("Bash", { command: "pwd" }, f.context)).toMatchObject({ behavior: "deny" });
    expect(f.requestToolApproval).not.toHaveBeenCalled();
  });
  it("passes native tool/action details and returns only an invocation grant", async () => {
    const f = setup(), input = { command: "pwd" };
    const result = await claudePermissionHandler(f.opts)("Bash", input, { ...f.context, title: "Run pwd?" });
    expect(f.requestToolApproval).toHaveBeenCalledWith({ tool: "Bash", input, reason: "Run pwd?" }, f.context.signal);
    expect(result).toEqual({ behavior: "allow", updatedInput: input });
    expect(result).not.toHaveProperty("updatedPermissions");
  });
  it("fails closed for unavailable, failed, denied and cancelled decisions", async () => {
    const f = setup();
    f.requestToolApproval.mockResolvedValueOnce("deny").mockRejectedValueOnce(new Error("offline"));
    for (let i = 0; i < 2; i++) expect(await claudePermissionHandler(f.opts)("Bash", {}, f.context)).toMatchObject({ behavior: "deny" });
    delete f.opts.requestToolApproval;
    expect(await claudePermissionHandler(f.opts)("Bash", {}, f.context)).toMatchObject({ behavior: "deny" });
    f.controller.abort();
    expect(await claudePermissionHandler(f.opts)("Bash", {}, f.context)).toMatchObject({ behavior: "deny" });
  });
  it("does not turn a blocked-path escalation into a user override", async () => {
    const f = setup();
    expect(await claudePermissionHandler(f.opts)("Bash", {}, { ...f.context, blockedPath: "/outside" })).toMatchObject({ behavior: "deny" });
    expect(f.requestToolApproval).not.toHaveBeenCalled();
  });
});
