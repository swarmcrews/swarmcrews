import { subscribeConnectionSession } from "../session-subscriptions.ts";
import { unicastToSession } from "../bus.ts";
import type { CommandHandler } from "./types.ts";
import { getSessionOrError, sendControlError, sendControlResponse } from "./helpers.ts";

export const respondToolApproval: CommandHandler = (ctx, cmd, ws) => {
  const host = getSessionOrError(ctx.registry, cmd.sessionKey, ws);
  if (!host) return;
  const decision = cmd.approvalDecision;
  if (!cmd.approvalId || (decision !== "allow_once" && decision !== "deny")
    || !host.toolApprovals.decide(cmd.approvalId, decision)) {
    sendControlError(ws, "respond_tool_approval", host.id, cmd.requestId, "This tool approval is no longer actionable.");
    return;
  }
  sendControlResponse(ws, "respond_tool_approval", host.id, cmd.requestId);
};

export const getToolApprovals: CommandHandler = (ctx, cmd, ws) => {
  const host = getSessionOrError(ctx.registry, cmd.sessionKey, ws);
  if (!host) return;
  subscribeConnectionSession(ws, host.id);
  unicastToSession(ws, host.id, { type: "tool_approval_snapshot", sessionKey: host.id, requests: host.toolApprovals.snapshot() });
};
