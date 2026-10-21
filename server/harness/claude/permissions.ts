import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { HarnessStartOptions } from "../types.ts";

/** This callback handles native asks, not hooks that override native denies. */
export function claudePermissionHandler(opts: HarnessStartOptions): CanUseTool {
  return async (tool, input, context) => {
    const deny = { behavior: "deny" as const, message: "Tool invocation was not approved." };
    if (opts.abortSignal.aborted || context.signal.aborted || !opts.requestToolApproval) return deny;
    // A native blocked-path ask is an escalation, not an in-boundary approval.
    if (context.blockedPath || !opts.allowedTools.includes(tool)) return deny;
    try {
      const decision = await opts.requestToolApproval({ tool, input,
        reason: context.title ?? context.decisionReason ?? context.description ?? "Claude requests permission for this action." }, context.signal);
      return decision === "allow_once" && !opts.abortSignal.aborted && !context.signal.aborted
        ? { behavior: "allow", updatedInput: input } : deny;
    } catch { return deny; }
  };
}
