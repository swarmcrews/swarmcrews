import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserRunnerService } from "./service.ts";
import { browserPolicySchema, type BrowserPolicy, type BrowserPrincipal } from "./policy.ts";
import type { BrowserBackend, BrowserExecution, BrowserExecutionResult } from "./backend.ts";
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers(); const root = realpathSync(mkdtempSync(join(tmpdir(), "browser-service-"))); roots.push(root);
  let now = 1000;
  let policy: BrowserPolicy = browserPolicySchema.parse({ version: 1, maxConcurrent: 2, runners: [{ id: "local", image: `localhost/test@sha256:${"a".repeat(64)}`, maxConcurrent: 2, timeoutSeconds: 10,
    grants: [{ sessionKey: "leader", projectPath: root, worktrees: [root], suites: ["smoke", "e2e"], manage: true, expiresAt: 100000 }] }] });
  const pending: { input: BrowserExecution; finish: (result: BrowserExecutionResult) => void }[] = [];
  const backend: BrowserBackend = { execute: input => new Promise(resolve => {
    pending.push({ input, finish: resolve });
    input.signal.addEventListener("abort", () => resolve({ exitCode: null }), { once: true });
  }) };
  const service = new BrowserRunnerService(() => policy, backend, () => now);
  const who = (sessionKey: string): BrowserPrincipal => ({ sessionKey, projectPath: root, cwd: root });
  const run = (sessionKey = "leader") => service.run(who(sessionKey), "local", "smoke", new AbortController().signal);
  return { service, who, run, pending, setPolicy: (p: BrowserPolicy) => { policy = p; }, policy, time: (t: number) => { now = t; } };
}
it("denies unknown sessions, project spoofing, suites and transitive delegation", async () => {
  const s = setup(); await expect(s.run("unknown")).rejects.toThrow("unavailable");
  s.service.grant(s.who("leader"), "local", "child", ["smoke"], 30);
  expect(() => s.service.grant(s.who("child"), "local", "other", ["smoke"], 30)).toThrow();
  await expect(s.service.run(s.who("child"), "local", "e2e", new AbortController().signal)).rejects.toThrow();
  expect(s.service.list({ ...s.who("child"), projectPath: tmpdir() })).toMatchObject({ status: "no_session_access", runners: [] });
});
it("shares capacity but isolates results between siblings; manager can inspect and cancel", async () => {
  const s = setup(); for (const child of ["a", "b", "c"]) s.service.grant(s.who("leader"), "local", child, ["smoke"], 30);
  const a = s.run("a"); const b = s.run("b");
  await expect(s.run("c")).rejects.toThrow("busy"); await expect(s.run("a")).rejects.toThrow("busy");
  const id = s.pending[0]!.input.id;
  expect(() => s.service.get(s.who("b"), id)).toThrow("unavailable");
  expect(() => s.service.cancel(s.who("b"), id)).toThrow("unavailable");
  s.pending[0]!.input.output("x".repeat(70000));
  expect(s.service.get(s.who("leader"), id)).toMatchObject({ truncated: true, nextOffset: 4096 });
  expect(s.service.get(s.who("leader"), id).log).toHaveLength(4096);
  s.service.cancel(s.who("leader"), id); expect((await a).status).toBe("cancelled");
  s.pending[1]!.finish({ exitCode: 1 }); expect((await b).status).toBe("failed");
});
it("revokes live delegated work immediately and blocks all further result access", async () => {
  const s = setup(); s.service.grant(s.who("leader"), "local", "a", ["smoke"], 30);
  const result = s.run("a"); const rejected = expect(result).rejects.toThrow("unavailable");
  s.service.revoke(s.who("leader"), "local", "a"); await rejected;
  expect(s.pending[0]!.input.signal.aborted).toBe(true);
  expect(() => s.service.get(s.who("a"), s.pending[0]!.input.id)).toThrow();
});
it("policy removal, parent edits, and expired leases revoke running work", async () => {
  const s = setup(); s.service.grant(s.who("leader"), "local", "a", ["smoke"], 1);
  const result = s.run("a"); const rejected = expect(result).rejects.toThrow();
  s.time(2001); s.service.sweep(); await rejected;
  s.service.grant(s.who("leader"), "local", "a", ["smoke"], 30);
  const again = s.run("a"); const denied = expect(again).rejects.toThrow();
  s.setPolicy({ ...s.policy, runners: [] }); s.service.sweep(); await denied;
});
it("keeps capacity until cleanup, quarantines failures, and never reports them passed", async () => {
  const s = setup(); const result = s.run(); s.pending[0]!.finish({ exitCode: 0, cleanupFailed: true });
  expect((await result).status).toBe("infrastructure_error");
  await expect(s.run()).rejects.toThrow("quarantined");
});
it("timeout aborts the backend and successful completion records a snapshot", async () => {
  const s = setup(); const result = s.run(); await vi.advanceTimersByTimeAsync(10001);
  expect((await result).status).toBe("timed_out");
  const next = s.run(); s.pending[1]!.input.snapshot("sha256-source"); s.pending[1]!.finish({ exitCode: 0 });
  expect(await next).toMatchObject({ status: "passed", snapshotDigest: "sha256-source" });
  s.time(1000000); s.service.sweep(); expect(() => s.service.get(s.who("leader"), s.pending[1]!.input.id)).toThrow();
});
it("invocation abort cancels work and does not free a different session's lease", async () => {
  const s = setup(); const controller = new AbortController();
  const result = s.service.run(s.who("leader"), "local", "smoke", controller.signal);
  controller.abort(); expect((await result).status).toBe("cancelled");
});
it("holds cancelled capacity until cleanup actually settles and quarantines thrown backend failures", async () => {
  const s = setup(); let finish!: (value: BrowserExecutionResult) => void;
  const backend: BrowserBackend = { execute: () => new Promise(resolve => { finish = resolve; }) };
  const service = new BrowserRunnerService(() => s.policy, backend, () => 1000);
  const pending = service.run(s.who("leader"), "local", "smoke", new AbortController().signal);
  const id = service.list(s.who("leader")).runners[0]!.runs[0]!.id;
  service.cancel(s.who("leader"), id);
  await expect(service.run(s.who("leader"), "local", "smoke", new AbortController().signal)).rejects.toThrow("busy");
  finish({ exitCode: null }); expect((await pending).status).toBe("cancelled");
  const broken = new BrowserRunnerService(() => s.policy, { execute: async () => { throw new Error("unexpected"); } }, () => 1000);
  expect((await broken.run(s.who("leader"), "local", "smoke", new AbortController().signal)).status).toBe("infrastructure_error");
  await expect(broken.run(s.who("leader"), "local", "smoke", new AbortController().signal)).rejects.toThrow("quarantined");
});
it("reports operator exclusions to authorized callers and revokes runs when those exclusions change", async () => {
  const s = setup(); s.policy.runners[0]!.sourceExclusions = ["artifacts"];
  expect(s.service.list(s.who("leader")).runners[0]!.sourceExclusions).toEqual(["artifacts"]);
  const running = s.run();
  s.setPolicy({ ...s.policy, runners: [{ ...s.policy.runners[0]!, sourceExclusions: ["artifacts", "build"] }] });
  s.service.sweep(); expect((await running).status).toBe("cancelled"); expect(s.pending[0]!.input.signal.aborted).toBe(true);
});
