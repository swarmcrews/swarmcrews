import { useEffect, useRef, useState } from "react";
import { restartServer } from "../api.ts";
import { containDialogFocus } from "../task-graph/dialog-focus.ts";

export function MobileServerSettings() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => trigger.current?.focus();
  }, [open]);
  const close = () => { if (state !== "pending") { setOpen(false); setState("idle"); } };
  async function restart() {
    setState("pending"); setError(null);
    try { await restartServer(); setState("sent"); }
    catch (err: unknown) { setState("idle"); setError(err instanceof Error ? err.message : "Could not restart the server."); }
  }
  return <>
    <section className="mob-settings-server" aria-label="Server administration" inert={open}>
      <p>Restart the active backend to pick up changed code. All connected devices and active sessions will disconnect briefly.</p>
      <button ref={trigger} type="button" className="mob-settings-danger-button" onClick={() => { setError(null); setOpen(true); }}>Restart Server</button>
    </section>
    {open && <div className="mob-settings-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label="Restart Swarmcrews server" aria-describedby="mob-restart-description" tabIndex={-1}
        className="mob-settings-modal" onKeyDown={event => {
          containDialogFocus(event.nativeEvent, event.currentTarget);
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        }}>
        <h2>Restart Swarmcrews server?</h2>
        <p id="mob-restart-description">{state === "sent" ? "Restart requested. The app will reconnect when the server is back." : "Active sessions will disconnect while the backend restarts. Use this only when you need the running server to pick up new code."}</p>
        {error && <p role="alert" className="mob-launch-error">{error}</p>}
        <div className="mob-settings-modal-actions">
          <button type="button" onClick={close} disabled={state === "pending"}>{state === "sent" ? "Close" : "Cancel"}</button>
          {state !== "sent" && <button type="button" className="mob-settings-danger-button" onClick={() => { void restart(); }} disabled={state === "pending"}>{state === "pending" ? "Restarting…" : "Restart Server"}</button>}
        </div>
      </div>
    </div>}
  </>;
}
