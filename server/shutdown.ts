export interface ShutdownDependencies {
  stopAdmission(): void;
  drain(): Promise<void>;
  cleanupOwned(): void;
  finish(code: number): void;
  report(error: unknown): void;
}
/** Idempotent, bounded cancellation. A timeout or cleanup error is never success. */
export function createShutdown(deps: ShutdownDependencies, timeoutMs = 8_000): (code?: number) => Promise<void> {
  let pending: Promise<void> | undefined;
  return (code = 0) => pending ??= (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result = code;
    try {
      deps.stopAdmission();
      await Promise.race([
        deps.drain(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Provider shutdown drain timed out")), timeoutMs); }),
      ]);
    } catch (error) { result = 1; deps.report(error); }
    finally { clearTimeout(timer); }
    try { deps.cleanupOwned(); } catch (error) { result = 1; deps.report(error); }
    deps.finish(result);
  })();
}

export function finishServerShutdown(code: number): void {
  if (process.env["SWARMCREWS_PACKAGED"] === "1" && process.connected) {
    // Keep the backend alive so Windows taskkill can still target its tree.
    // If the supervisor dies after the acknowledgement, do not remain orphaned.
    process.once("disconnect", () => process.exit(code));
    process.send!({ type: "shutdown-ready", code }, error => { if (error) process.exit(1); });
  } else process.exit(code);
}
