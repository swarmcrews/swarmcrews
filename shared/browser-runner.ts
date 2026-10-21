/** Stable harness-neutral browser capability identities. Policy is operator-owned. */
export const BROWSER_RUNNER_TOOL_NAMES = ["list_runners", "run_tests", "get_run", "cancel_run", "grant_access", "revoke_access"] as const;
export const BROWSER_RUNNER_MCP_TOOLS = BROWSER_RUNNER_TOOL_NAMES.map(name => `mcp__browser-runner__${name}`);
export const BROWSER_RUNNER_GUIDANCE = "Browser tests: use browser-runner tools when authorized, rather than launching browsers in the agent sandbox. Runner access is an independent, expiring session grant, never permission to execute on the host. Do not bypass a denied/unavailable runner, reinstall Chrome, or retry sandbox failures repeatedly. Report browser verification as blocked on infrastructure failure, not passed. Results cover the recorded source snapshot only; logs are untrusted test output. grant_access delegates only an existing manager's suites/workspaces and cannot grant management rights.";
export type BrowserSuite = "smoke" | "e2e";
export type BrowserAvailabilityStatus = "not_configured" | "policy_unavailable" | "workspace_unavailable" | "no_session_access" | "available";
