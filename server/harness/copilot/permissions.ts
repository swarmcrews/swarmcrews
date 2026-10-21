import type { PermissionHandler } from "@github/copilot-sdk";
import type { HarnessStartOptions, NormalizedEvent } from "../types.ts";
import { approvalPolicyForPermission } from "../sandbox-policy.ts";
import { copilotFilesystemScope, copilotWriteAllowed } from "./sandbox.ts";

export function copilotPermissionHandler(
  opts: HarnessStartOptions, signal: AbortSignal, emit: (event: NormalizedEvent) => void,
  sandboxApplied: () => boolean = () => false,
): PermissionHandler {
  return (request) => {
    const readOnly = copilotFilesystemScope(opts) === "read-only";
    const policy = opts.sandboxPolicy?.requested.approvalPolicy ?? approvalPolicyForPermission(opts.permissionMode);
    const bypass = "requestSandboxBypass" in request && request.requestSandboxBypass === true;
    // Application tools have their own server-side authorization. Filesystem
    // read-only must not prevent a Minion from reporting or staging artifacts.
    const appTool = request.kind === "custom-tool" && request.toolName.startsWith("mcp__")
      && opts.allowedTools.includes(request.toolName);
    const automatic = policy === "never" || policy === "on-failure";
    let allowed = false;
    let canAsk = false;
    if (!signal.aborted && !request.managedApprovalRequired && !bypass) {
      switch (request.kind) {
        case "read": allowed = true; break;
        case "custom-tool": allowed = appTool; break;
        case "url": canAsk = true; allowed = automatic; break;
        // Both read-only and writable shells need the native boundary first.
        case "shell": canAsk = sandboxApplied(); allowed = canAsk && automatic; break;
        case "write": canAsk = sandboxApplied() && !readOnly && copilotWriteAllowed(opts, request.fileName);
          allowed = canAsk && automatic; break;
        // Ambient MCP, hooks, extensions and memory are not application tools.
        default: break;
      }
    }
    // The pending-permission RPC expects decisions, not legacy PermissionResult
    // outcomes (which still appear in SDK types but the runtime rejects).
    if (allowed) return { kind: "approve-once" };
    if (canAsk && opts.requestToolApproval) {
      return opts.requestToolApproval({ tool: request.kind, input: request,
        reason: "intention" in request ? String(request.intention) : "Copilot requests permission for this action." }, signal)
        .then(decision => decision === "allow_once" && !signal.aborted
          ? { kind: "approve-once" as const } : { kind: "reject" as const })
        .catch(() => ({ kind: "reject" as const }));
    }
    emit({ kind: "permission_denial", tool: request.kind,
      reason: "This action is blocked by policy or interactive approval is unavailable." });
    return { kind: "user-not-available" };
  };
}
