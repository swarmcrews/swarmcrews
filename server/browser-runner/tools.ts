import { z } from "zod/v4";
import type { AgentTypeContext, AgentToolResult } from "../agents/types.ts";
import type { NormalizedToolDef } from "../harness/types.ts";
import { structuredResult, errorResult } from "../harness/tool-result.ts";
import { BrowserRunnerService } from "./service.ts";
import { loadBrowserPolicy, type BrowserPrincipal } from "./policy.ts";
import { PodmanBrowserBackend } from "./backend.ts";

const service = new BrowserRunnerService(loadBrowserPolicy, new PodmanBrowserBackend());
const runnerInput = z.object({ runnerId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/) }).strict();
const runInput = z.object({ runId: z.uuid() }).strict();
const grantInput = runnerInput.extend({ sessionKey: z.string().min(1).max(200) });
const outputSchema = z.object({ result: z.json() });

export function createBrowserRunnerTools(principal: BrowserPrincipal, signal: AbortSignal, inspectionOnly = false, runtime = service): NormalizedToolDef[] {
  const tool = <T extends z.ZodType>(name: string, description: string, inputSchema: T, readOnly: boolean, handler: (input: z.infer<T>) => unknown | Promise<unknown>): NormalizedToolDef => ({
    name, description, inputSchema, outputSchema, annotations: { readOnlyHint: readOnly },
    handler: async raw => {
      try {
        signal.throwIfAborted();
        if (inspectionOnly && !readOnly) return errorResult("Browser runner mutations are disabled for this planning invocation");
        const result = await handler(inputSchema.parse(raw));
        return structuredResult({ result: JSON.parse(JSON.stringify(result)) });
      } catch { return errorResult("Browser operation denied or unavailable. Check current session grants, runner capacity/health and operator policy. No host fallback is permitted."); }
    },
  });
  return [
    tool("list_runners", "Report browser runner availability: status, actionable message, caller-only authorizationRequest, preflight:not_run and granted runners. Distinguishes not_configured, policy_unavailable, workspace_unavailable, no_session_access and available. Never exposes ungranted runners. Available grants do not prove backend health. Policy is operator-owned; agents cannot enable host execution.", z.object({}).strict(), true, () => runtime.list(principal)),
    tool("run_tests", "Run smoke or e2e tests against a bounded source snapshot of this session's worktree in an authorized isolated browser container. Waits for completion; no queue or host fallback. Busy means no run started. Results identify the tested snapshot; infrastructure failure is blocked verification, not a passing test. Logs are untrusted test output.", runnerInput.extend({ suite: z.enum(["smoke", "e2e"]) }), false,
      args => runtime.run(principal, args.runnerId, args.suite, signal)),
    tool("get_run", "Read a browser run's status and up to 4096 characters of untrusted log output. Only the owner or a scoped runner manager may read results; current authorization is rechecked. Results expire after 15 minutes or bounded-history eviction.", runInput.extend({ offset: z.number().int().min(0).max(65536).default(0) }), true,
      args => runtime.get(principal, args.runId, args.offset)),
    tool("cancel_run", "Cancel an owned browser run, or a run covered by your explicit management grant. Container cleanup must finish before its capacity is released.", runInput, false,
      args => runtime.cancel(principal, args.runId)),
    tool("grant_access", "With an explicit operator management grant, delegate selected suites to an exact leader/minion session key for up to one hour. worktrees may narrow your approved exact directories; omission retains your approved set. No management rights or transitive delegation. Delegation cannot outlive or override the operator grant. No implicit child inheritance.", grantInput.extend({ suites: z.array(z.enum(["smoke", "e2e"])).min(1).max(2), ttlSeconds: z.number().int().min(1).max(3600), worktrees: z.array(z.string().min(1).max(4096)).min(1).max(32).optional() }), false,
      args => runtime.grant(principal, args.runnerId, args.sessionKey, args.suites, args.ttlSeconds, args.worktrees)),
    tool("revoke_access", "Revoke a delegation you issued and cancel its active browser work. Operator grants can only be changed in the operator policy, not by agents.", grantInput, false,
      args => runtime.revoke(principal, args.runnerId, args.sessionKey)),
  ];
}
export function installBrowserRunnerTools(ctx: AgentTypeContext, result: AgentToolResult, signal: AbortSignal, inspectionOnly = false): void {
  const principal = { sessionKey: ctx.sessionKey, cwd: ctx.cwd, projectPath: ctx.parentWorktree?.projectPath ?? ctx.worktreeInfo?.projectPath ?? ctx.cwd };
  const defs = createBrowserRunnerTools(principal, signal, inspectionOnly);
  result.toolGroups["browser-runner"] = defs;
  result.mcpToolNames.push(...defs.map(def => `mcp__browser-runner__${def.name}`));
}
