import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserRunnerService } from "./service.ts";
import { browserPolicySchema, loadBrowserPolicy, type BrowserPolicy } from "./policy.ts";

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs(); });
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "browser-diagnostics-"))); roots.push(root);
  const principal = { sessionKey: "caller", projectPath: root, cwd: root };
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const policy = browserPolicySchema.parse({ version: 1, runners: [{ id: "private-runner", image: `sha256:${"a".repeat(64)}`, grants: [{ sessionKey: "caller", projectPath: root, worktrees: [root], suites: ["smoke"], expiresAt: 2000 }] }] });
  const service = (read: () => BrowserPolicy = () => policy) => new BrowserRunnerService(read, { execute }, () => 1000);
  return { root, principal, execute, policy, service };
}

it("explains disabled configuration and provides only the caller's grant-request identity", () => {
  vi.stubEnv("SWARMCREWS_BROWSER_POLICY", "");
  const s = setup();
  expect(s.service(loadBrowserPolicy).list(s.principal)).toMatchObject({
    status: "not_configured", runners: [], preflight: "not_run",
    authorizationRequest: { sessionKey: "caller", projectPath: s.root, worktrees: [s.root] },
  });
  expect(s.service(loadBrowserPolicy).list(s.principal).message).toContain("SWARMCREWS_BROWSER_POLICY");
  expect(s.execute).not.toHaveBeenCalled();
});

it("distinguishes authorized discovery from verified backend health", () => {
  const s = setup(); const result = s.service().list(s.principal);
  expect(result).toMatchObject({ status: "available", preflight: "not_run", runners: [{ id: "private-runner", suites: ["smoke"] }] });
  expect(result.message).toContain("not been checked");
  expect(s.execute).not.toHaveBeenCalled();
});

it("does not reveal runners, images or other sessions' grant details when access is absent", () => {
  const s = setup(); const who = { ...s.principal, sessionKey: "outsider" };
  const result = s.service().list(who);
  expect(result).toMatchObject({ status: "no_session_access", runners: [], authorizationRequest: { sessionKey: "outsider" } });
  const text = JSON.stringify(result);
  expect(text).not.toContain("private-runner"); expect(text).not.toContain(s.policy.runners[0]!.image);
  expect(text).not.toContain('"caller"'); expect(text).not.toContain("expiresAt");
  // Expired or mismatched identities receive the same nonspecific reason.
  s.policy.runners[0]!.grants[0]!.expiresAt = 999;
  expect(s.service().list(s.principal).status).toBe("no_session_access");
  s.policy.runners[0]!.grants[0]!.expiresAt = 2000;
  expect(s.service().list({ ...s.principal, projectPath: realpathSync(tmpdir()) }).status).toBe("no_session_access");
  expect(s.service().list({ ...s.principal, cwd: realpathSync(tmpdir()) }).status).toBe("no_session_access");
  expect(s.execute).not.toHaveBeenCalled();
});

it("turns policy read/validation failures into actionable diagnostics without leaking raw errors", async () => {
  const s = setup();
  const service = s.service(() => { throw new Error("secret-policy-path: confidential parse details"); });
  const result = service.list(s.principal);
  expect(result).toMatchObject({ status: "policy_unavailable", runners: [] });
  expect(JSON.stringify(result)).not.toContain("secret-policy-path");
  expect(result.message).toContain("root-owned");
  await expect(service.run(s.principal, "private-runner", "smoke", new AbortController().signal)).rejects.toThrow();
  expect(s.execute).not.toHaveBeenCalled();
});

it("reports unavailable workspace identity rather than fabricating a grant request", () => {
  const s = setup();
  const result = s.service().list({ ...s.principal, cwd: join(s.root, "missing") });
  expect(result).toMatchObject({ status: "workspace_unavailable", runners: [] });
  expect(result.authorizationRequest).toBeUndefined();
  expect(s.execute).not.toHaveBeenCalled();
});
