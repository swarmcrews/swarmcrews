import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { setup, cmd } from "../support/server-command-harness.ts";
import { respondToolApproval } from "../../server/commands/respond-tool-approval.ts";
import { syncSession } from "../../server/commands/sync-session.ts";
import { validateWsCommand } from "../../server/commands/schemas.ts";

describe("tool approval WS contract", () => {
  it("requires a specific request, session and one-shot decision", () => {
    const valid = { type: "respond_tool_approval", sessionKey: "leader-1", requestId: randomUUID(), approvalId: randomUUID(), approvalDecision: "deny" };
    expect(validateWsCommand(valid).ok).toBe(true);
    for (const patch of [{ approvalDecision: "always" }, { sessionKey: "" }, { approvalId: undefined }, { requestId: undefined }]) {
      expect(validateWsCommand({ ...valid, ...patch }).ok).toBe(false);
    }
  });
  it("routes only to the requesting host, rejects repeats, and sync excludes settled asks", async () => {
    const a = setup(), other = setup({ sessionKey: "other" });
    const request = a.host.toolApprovals.begin(a.host.abortController.signal, e => a.ctx.bus.emitToSession(a.host.id, { ...e }));
    const result = request({ tool: "shell", input: { command: "pwd" } });
    const approvalId = a.host.toolApprovals.snapshot()[0]!.id;
    syncSession(a.ctx, cmd({ type: "sync_session" }), a.ws);
    expect(a.wsSent.at(-1)).toMatchObject({ toolApprovals: [{ id: approvalId, tool: "shell" }] });
    const command = cmd({ type: "respond_tool_approval", approvalId, approvalDecision: "allow_once", requestId: randomUUID() });
    respondToolApproval(other.ctx, { ...command, sessionKey: "other" }, other.ws);
    expect(other.wsSent.at(-1)).toMatchObject({ success: false });
    respondToolApproval(a.ctx, command, a.ws);
    expect(a.wsSent.at(-1)).toMatchObject({ success: true });
    expect(await result).toBe("allow_once");
    respondToolApproval(a.ctx, command, a.ws);
    expect(a.wsSent.at(-1)).toMatchObject({ success: false });
    syncSession(a.ctx, cmd({ type: "sync_session" }), a.ws);
    expect(a.wsSent.at(-1)).toMatchObject({ toolApprovals: [] });
  });
});
