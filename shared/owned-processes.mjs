import { spawnSync } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { join } from "node:path";

export function killOwnedProcess(pid, detached = false) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error("Invalid owned process ID");
  if (process.platform === "win32") {
    try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") return; throw error; }
    const result = spawnSync(join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    if (result.error || result.status !== 0) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") return; }
      throw result.error ?? new Error(`Failed to stop owned process tree ${pid}`);
    }
  } else {
    try { process.kill(detached ? -pid : pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}

/** Track Node-spawned provider roots, including groups detached from the server.
 * This is supervision, not a sandbox or an OS-wide descendant guarantee. */
export function observeOwnedProcesses() {
  const owned = new Map();
  const notify = message => { if (process.connected) process.send(message, () => {}); };
  const observe = ({ process: child }) => {
    child.once("spawn", () => {
      const pid = child.pid;
      if (!pid) return;
      let detached = false;
      if (process.platform !== "win32") {
        try { process.kill(-pid, 0); detached = true; } catch { /* Shares server group. */ }
      }
      owned.set(pid, detached);
      notify({ type: "owned-process", pid, detached });
      child.once("close", () => {
        // A departed group leader is not proof that its shell children exited.
        if (detached) killOwnedProcess(pid, true);
        owned.delete(pid);
        notify({ type: "released-process", pid });
      });
    });
  };
  subscribe("child_process", observe);
  return () => {
    unsubscribe("child_process", observe);
    const errors = [];
    for (const [pid, detached] of owned) {
      try { killOwnedProcess(pid, detached); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Owned process cleanup failed");
  };
}
