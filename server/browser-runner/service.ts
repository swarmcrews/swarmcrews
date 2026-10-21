import { randomUUID, createHash } from "node:crypto";
import { browserRunnerAvailability } from "./availability.ts";
import type { BrowserSuite } from "../../shared/browser-runner.ts";
import type { BrowserBackend } from "./backend.ts";
import { canonicalPrincipal, matchesGrant, type BrowserGrant, type BrowserPolicy, type BrowserPrincipal, type BrowserRunner } from "./policy.ts";

type Delegation = { runnerId: string; grant: BrowserGrant; issuer: BrowserPrincipal; parentFingerprint: string };
type Status = "running" | "passed" | "failed" | "infrastructure_error" | "cancelled" | "timed_out";
type Run = {
  id: string; runnerId: string; owner: BrowserPrincipal; suite: BrowserSuite; status: Status;
  startedAt: number; finishedAt?: number; snapshotDigest?: string; exitCode?: number | null;
  error?: string; log: string; truncated: boolean; controller: AbortController;
  runnerFingerprint: string; occupied: boolean;
};
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const executionFingerprint = ({ grants: _grants, ...runner }: BrowserRunner) => fingerprint(runner);
const unavailable = () => new Error("Browser runner or run unavailable to this session");

export class BrowserRunnerService {
  private runs = new Map<string, Run>();
  private delegations = new Map<string, Delegation>();
  private quarantined = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(private policy: () => BrowserPolicy, private backend: BrowserBackend, private now = Date.now) {}
  private key(runner: string, session: string) { return JSON.stringify([runner, session]); }
  private access(policy: BrowserPolicy, runnerId: string, principal: BrowserPrincipal): { runner: BrowserRunner; grant: BrowserGrant } {
    const runner = policy.runners.find(r => r.id === runnerId);
    if (!runner) throw unavailable();
    const direct = runner.grants.find(g => matchesGrant(g, principal, this.now()));
    if (direct) return { runner, grant: direct };
    const delegated = this.delegations.get(this.key(runnerId, principal.sessionKey));
    if (delegated && matchesGrant(delegated.grant, principal, this.now())) {
      const parent = runner.grants.find(g => matchesGrant(g, delegated.issuer, this.now()) && g.manage);
      if (parent && fingerprint(parent) === delegated.parentFingerprint) return { runner, grant: delegated.grant };
    }
    throw unavailable();
  }
  private current(principal: BrowserPrincipal, runnerId: string) {
    return this.access(this.policy(), runnerId, canonicalPrincipal(principal));
  }
  list(principal: BrowserPrincipal) {
    let who: BrowserPrincipal;
    try { who = canonicalPrincipal(principal); }
    catch { return browserRunnerAvailability("workspace_unavailable", []); }
    let policy: BrowserPolicy;
    try { policy = this.policy(); }
    catch { return browserRunnerAvailability("policy_unavailable", [], who); }
    if (!policy.runners.length) return browserRunnerAvailability("not_configured", [], who);
    const runners = policy.runners.flatMap(runner => {
      try {
        const { grant } = this.access(policy, runner.id, who);
        return [{ id: runner.id, suites: grant.suites, worktrees: grant.worktrees, manage: grant.manage, expiresAt: grant.expiresAt,
          maxConcurrent: runner.maxConcurrent, timeoutSeconds: runner.timeoutSeconds,
          memoryMb: runner.memoryMb, cpus: runner.cpus, pids: runner.pids, workspaceMb: runner.workspaceMb, sourceExclusions: runner.sourceExclusions,
          quarantined: this.quarantined.has(runner.id),
          runs: [...this.runs.values()].filter(run => run.runnerId === runner.id && this.canRead(run, who, grant)).map(run => this.view(run)) }];
      } catch { return []; }
    });
    return browserRunnerAvailability(runners.length ? "available" : "no_session_access", runners, who);
  }
  grant(principal: BrowserPrincipal, runnerId: string, sessionKey: string, suites: BrowserSuite[], ttlSeconds: number, worktrees?: string[]) {
    const issuer = canonicalPrincipal(principal); const { grant: parent, runner } = this.current(issuer, runnerId);
    if (!parent.manage || sessionKey === issuer.sessionKey || runner.grants.some(g => g.sessionKey === sessionKey)) throw unavailable();
    if (!suites.length || suites.some(s => !parent.suites.includes(s)) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) throw unavailable();
    if (this.delegations.size >= 128 && !this.delegations.has(this.key(runnerId, sessionKey))) throw new Error("Browser grant capacity reached");
    if (worktrees && (!worktrees.length || worktrees.some(path => !parent.worktrees.includes(path)))) throw unavailable();
    const grant: BrowserGrant = { ...parent, sessionKey, worktrees: worktrees ? [...new Set(worktrees)] : [...parent.worktrees], suites: [...new Set(suites)], manage: false, expiresAt: Math.min(parent.expiresAt, this.now() + ttlSeconds * 1000) };
    const existing = this.delegations.get(this.key(runnerId, sessionKey));
    if (existing && existing.issuer.sessionKey !== issuer.sessionKey) throw unavailable();
    this.delegations.set(this.key(runnerId, sessionKey), { runnerId, grant, issuer, parentFingerprint: fingerprint(parent) });
    this.watch(); this.sweep(); return { sessionKey, suites: grant.suites, expiresAt: grant.expiresAt };
  }
  revoke(principal: BrowserPrincipal, runnerId: string, sessionKey: string) {
    const issuer = canonicalPrincipal(principal); const { grant } = this.current(issuer, runnerId);
    const key = this.key(runnerId, sessionKey); const delegated = this.delegations.get(key);
    if (!grant.manage || !delegated || delegated.issuer.sessionKey !== issuer.sessionKey) throw unavailable();
    this.delegations.delete(key); this.sweep(); return { revoked: true };
  }
  private canRead(run: Run, who: BrowserPrincipal, grant: BrowserGrant) {
    return run.owner.projectPath === who.projectPath && grant.worktrees.includes(run.owner.cwd)
      && grant.suites.includes(run.suite) && (run.owner.sessionKey === who.sessionKey || grant.manage);
  }
  private authorizedRun(principal: BrowserPrincipal, id: string): Run {
    const run = this.runs.get(id); if (!run) throw unavailable();
    const who = canonicalPrincipal(principal); const { grant } = this.current(who, run.runnerId);
    if (!this.canRead(run, who, grant)) throw unavailable(); return run;
  }
  private view(run: Run) {
    return { id: run.id, runnerId: run.runnerId, sessionKey: run.owner.sessionKey, suite: run.suite, status: run.status,
      startedAt: run.startedAt, finishedAt: run.finishedAt, snapshotDigest: run.snapshotDigest,
      exitCode: run.exitCode, error: run.error, truncated: run.truncated };
  }
  get(principal: BrowserPrincipal, id: string, offset = 0) {
    const run = this.authorizedRun(principal, id);
    if (!Number.isInteger(offset) || offset < 0 || offset > 65536) throw new Error("Invalid log offset");
    return { ...this.view(run), log: run.log.slice(offset, offset + 4096), nextOffset: offset + 4096 < run.log.length ? offset + 4096 : null };
  }
  cancel(principal: BrowserPrincipal, id: string) {
    const run = this.authorizedRun(principal, id); this.stop(run, "cancelled"); return this.view(run);
  }
  private stop(run: Run, status: "cancelled" | "timed_out") {
    if (run.status !== "running") return;
    run.status = status; run.controller.abort();
  }
  private watch() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), 1000); this.timer.unref();
  }
  /** Re-check revocation even while a test never returns, and bound retained evidence. */
  sweep() {
    let policy: BrowserPolicy | undefined;
    try { policy = this.policy(); } catch { /* Invalid or missing policy revokes active authority. */ }
    for (const [key, delegated] of this.delegations) {
      const parent = policy?.runners.find(r => r.id === delegated.runnerId)?.grants.find(g => matchesGrant(g, delegated.issuer, this.now()) && g.manage);
      if (!parent || delegated.grant.expiresAt <= this.now() || fingerprint(parent) !== delegated.parentFingerprint) this.delegations.delete(key);
    }
    for (const [id, run] of this.runs) {
      if (run.status === "running") {
        try {
          if (!policy) throw unavailable();
          const { runner, grant } = this.access(policy, run.runnerId, run.owner);
          if (!grant.suites.includes(run.suite) || executionFingerprint(runner) !== run.runnerFingerprint) throw unavailable();
        } catch { this.stop(run, "cancelled"); }
      }
      if (!run.occupied && run.finishedAt !== undefined && run.finishedAt < this.now() - 15 * 60_000) this.runs.delete(id);
    }
    if (!this.runs.size && !this.delegations.size && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }
  async run(principal: BrowserPrincipal, runnerId: string, suite: BrowserSuite, signal: AbortSignal) {
    signal.throwIfAborted(); this.sweep();
    const owner = canonicalPrincipal(principal); const policy = this.policy(); const { runner, grant } = this.access(policy, runnerId, owner);
    if (!grant.suites.includes(suite)) throw unavailable();
    const active = [...this.runs.values()].filter(r => r.occupied);
    if (this.quarantined.has(runnerId)) throw new Error("Runner quarantined after unconfirmed cleanup; operator intervention required");
    if (active.length >= policy.maxConcurrent || active.filter(r => r.runnerId === runnerId).length >= runner.maxConcurrent
      || active.some(r => r.owner.sessionKey === owner.sessionKey)) throw new Error("Browser runner busy; no work was queued");
    if (this.runs.size >= 64) {
      const oldest = [...this.runs.values()].find(r => !r.occupied);
      if (oldest) this.runs.delete(oldest.id); else throw new Error("Browser history capacity reached");
    }
    const run: Run = { id: randomUUID(), runnerId, owner, suite, status: "running", startedAt: this.now(),
      log: "", truncated: false, controller: new AbortController(), runnerFingerprint: executionFingerprint(runner), occupied: true };
    this.runs.set(run.id, run); this.watch();
    const abort = () => this.stop(run, "cancelled"); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(() => this.stop(run, "timed_out"), runner.timeoutSeconds * 1000); timer.unref();
    try {
      const result = await this.backend.execute({ id: run.id, runner, cwd: owner.cwd, suite, signal: run.controller.signal,
        snapshot: digest => { run.snapshotDigest = digest; },
        output: text => { const remaining = 65536 - run.log.length; run.log += text.slice(0, remaining); if (text.length > remaining) run.truncated = true; } });
      run.exitCode = result.exitCode;
      // Revalidate at completion; expired/revoked authority must not release evidence.
      this.sweep();
      if (run.status === "running") run.status = result.infrastructureError ? "infrastructure_error" : result.exitCode === 0 ? "passed" : "failed";
      run.error = result.infrastructureError;
      if (result.cleanupFailed) { this.quarantined.add(runnerId); run.status = "infrastructure_error"; run.error = "Container cleanup unconfirmed; runner quarantined"; }
      else run.occupied = false;
    } catch {
      // An unexpected backend exception cannot establish cleanup; retain the resource lease.
      this.quarantined.add(runnerId); run.status = "infrastructure_error"; run.error = "Unexpected runner failure; cleanup unconfirmed";
    } finally {
      clearTimeout(timer); signal.removeEventListener("abort", abort); run.finishedAt = this.now();
    }
    return this.get(owner, run.id);
  }
}
