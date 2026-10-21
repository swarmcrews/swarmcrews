import type { Bus } from "./bus.ts";
import type { SessionHost } from "./session-host.ts";
import { serverLogger } from "./logging.ts";

const log = serverLogger.child("session-completion");
const pending = new WeakMap<SessionHost, () => void>();

export function cancelSessionCompletion(host: SessionHost): void {
  pending.get(host)?.();
}

/**
 * A final Leader response can precede the last child's provider completion,
 * even after all task reports have been delivered. Re-project that response
 * when automatic activity drains; do not replay onComplete or a ledger witness.
 */
export function watchSessionCompletion(
  host: SessionHost, bus: Bus, isReady: () => boolean, complete: () => void,
): void {
  cancelSessionCompletion(host);
  const generation = host.providerInvocationGeneration;
  const controller = host.abortController;
  let queued = false;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    unsubscribe();
    controller.signal.removeEventListener("abort", cancel);
    if (pending.get(host) === cancel) pending.delete(host);
  };
  const schedule = () => {
    if (queued || cancelled) return;
    queued = true;
    // Lifecycle publishers can still be updating task state / queuing wakes
    // inside a terminal-witness transaction. Observe the completed transition.
    queueMicrotask(() => {
      queued = false;
      if (cancelled) return;
      if (controller.signal.aborted || host.abortController !== controller
        || host.providerInvocationGeneration !== generation || host.runtimeTerminalNotified
        || host.status !== "idle") { cancel(); return; }
      try {
        if (!isReady()) return;
        cancel();
        complete();
      } catch (error) {
        cancel();
        log.warn("reconciliation_failed", { sessionKey: host.id, error });
      }
    });
  };
  const unsubscribe = bus.subscribe(event => {
    if (["task_graph_changed", "task_graph_plan_changed"].includes(event.type)
      && host.workItemId && event["workItemId"] === host.workItemId) {
      schedule();
      return;
    }
    const key = event["sessionKey"] ?? event["leaderSessionKey"];
    if (key !== host.id && ![...host.taskState?.tasks.values() ?? []]
      .some(task => task.minionSessionKey === key)) return;
    if (["session_status", "session_error", "task_plan_update", "wait_state"].includes(event.type)) schedule();
  });
  pending.set(host, cancel);
  controller.signal.addEventListener("abort", cancel, { once: true });
  schedule();
}
