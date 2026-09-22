// This is an early-failure observation window, not an application health check.
// Keep the CLI alive briefly before releasing the detached runner.
export function observeStartup(child, windowMs = 3_000) {
  return new Promise((resolve, reject) => {
    let output = "";
    let failure;
    const append = chunk => { output = (output + chunk).slice(-64 * 1024); };
    const error = reason => new Error(`${reason}${output.trim() ? `\n${output.trim()}` : ""}`);
    const finish = reason => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("close", onClose);
      child.off("message", onMessage);
      child.stdout?.off("data", append);
      child.stderr?.off("data", append);
      if (reason) reject(error(reason));
      else resolve();
    };
    const onError = err => finish(err.message);
    const onClose = (code, signal) => finish(failure ?? `Runner exited (${signal ?? code}) during startup.`);
    const onMessage = message => {
      if (message?.type !== "startup-failure") return;
      append(message.output ?? "");
      if (failure) return;
      failure = message.message || "Service failed during startup.";
      // Once failure is known, never approve startup just because cleanup runs
      // beyond the observation window. Give the runner time to reap services.
      clearTimeout(timer);
      timer = setTimeout(() => finish(failure), 5_000);
    };
    let timer = setTimeout(() => {
      finish(failure ?? (child.exitCode !== null || child.signalCode !== null
        ? `Runner exited (${child.signalCode ?? child.exitCode}) during startup.` : null));
    }, windowMs);
    child.once("error", onError);
    child.once("close", onClose);
    child.on("message", onMessage);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
  });
}

export function releaseStartupObserver(child) {
  if (child.connected) child.disconnect();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}
