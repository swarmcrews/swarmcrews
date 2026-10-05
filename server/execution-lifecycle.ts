import type { SessionHost } from "./session-host.ts";
import { trackWorktreeExecution } from "./commands/worktree-operation-lock.ts";

/** Admission and drain accounting is independent of a host's displayed status. */
export class ExecutionLifecycle<T> {
  private stopping = false;
  private readonly active = new Map<T, Set<Promise<void>>>();
  track(owner: T): () => void {
    if (this.stopping) throw new Error("Server is shutting down; new execution is disabled");
    let done!: () => void;
    const drain = new Promise<void>(resolve => { done = resolve; });
    const drains = this.active.get(owner) ?? new Set<Promise<void>>();
    drains.add(drain); this.active.set(owner, drains);
    return () => { done(); drains.delete(drain); if (!drains.size) this.active.delete(owner); };
  }
  async shutdown(stop: (owner: T) => Promise<void>): Promise<void> {
    this.stopping = true;
    const owners = [...this.active.entries()];
    await Promise.all(owners.map(async ([owner, drains]) => {
      const pending = [...drains];
      await stop(owner);
      await Promise.all(pending);
    }));
  }
}
const executions = new ExecutionLifecycle<SessionHost>();
export function trackServerExecution(host: SessionHost): () => void {
  const releaseServer = executions.track(host);
  const releaseWorktree = trackWorktreeExecution(host);
  return () => { releaseWorktree(); releaseServer(); };
}
export function shutdownExecutions(): Promise<void> {
  return executions.shutdown(async host => {
    const control = host.runControl;
    const stopping = host.terminate("stop");
    await Promise.all([stopping, control?.close?.()]);
  });
}
