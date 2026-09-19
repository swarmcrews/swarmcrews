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
    if (!signal.aborted && !request.managedApprovalRequired && !bypass) {
      switch (request.kind) {
        case "read": allowed = true; break;
        case "custom-tool": allowed = appTool; break;
        case "url": allowed = automatic; break;
        // Both read-only and writable shells need the native boundary first.
        case "shell": allowed = sandboxApplied() && automatic; break;
        case "write": allowed = sandboxApplied() && !readOnly
          && copilotWriteAllowed(opts, request.fileName)
          && (automatic || opts.permissionMode === "acceptEdits"); break;
        // Ambient MCP, hooks, extensions and memory are not application tools.
        default: break;
      }
    }
    // The pending-permission RPC expects decisions, not legacy PermissionResult
    // outcomes (which still appear in SDK types but the runtime rejects).
    if (allowed) return { kind: "approve-once" };
    emit({ kind: "permission_denial", tool: request.kind,
      reason: "Copilot requires approval that this harness cannot request interactively." });
    return { kind: "user-not-available" };
  };
}
