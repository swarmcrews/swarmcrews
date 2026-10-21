import type { BrowserAvailabilityStatus } from "../../shared/browser-runner.ts";
import type { BrowserPrincipal } from "./policy.ts";

const messages: Record<BrowserAvailabilityStatus, string> = {
  not_configured: "No browser runners are configured. An operator must set SWARMCREWS_BROWSER_POLICY in the server environment to a protected policy containing runners; restart the server after changing its environment.",
  policy_unavailable: "Browser policy could not be read or validated. Ask the operator to check the server policy path, JSON schema, root-owned non-group/world-writable file and ancestry, and canonical project/worktree directories. Access remains denied.",
  workspace_unavailable: "This session's project or execution directory could not be resolved. Restore the workspace or start a session in an existing canonical directory before requesting a grant.",
  no_session_access: "No current grant matches this session, project and exact execution worktree. Ask an operator or an authorized manager for a scoped, unexpired grant using authorizationRequest. Grants do not automatically transfer to new sessions or minions.",
  available: "Session grants are available. Podman, image and cgroup health have not been checked; run an authorized smoke suite to verify execution. Quarantined runners require operator recovery.",
};

/** Never include raw policy errors, ungranted resources or another session's identity. */
export function browserRunnerAvailability<T>(status: BrowserAvailabilityStatus, runners: T[], principal?: BrowserPrincipal) {
  return {
    status, message: messages[status], preflight: "not_run" as const, runners,
    ...(principal ? { authorizationRequest: { sessionKey: principal.sessionKey, projectPath: principal.projectPath, worktrees: [principal.cwd] } } : {}),
  };
}
