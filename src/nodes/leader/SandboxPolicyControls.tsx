import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { SelectedSetting } from "./SelectedSetting.tsx";
import {
  DEFAULT_SANDBOX_POLICY,
  type SandboxPolicy,
  type SandboxResolution,
} from "../../../shared/workspace-contracts.ts";
import type { HarnessCapabilities } from "../../use-socket.ts";
import { SANDBOX_ACCESS_OPTIONS, sandboxAccessValue, withSandboxAccess } from "../../sandbox-access.ts";

export { DEFAULT_SANDBOX_POLICY };

const SANDBOX_HELP = {
  filesystem: "Sets the agent process's file boundary. Read only prevents edits, Workspace write limits edits to authorized project roots, and Full Host removes that boundary for the Leader only or for the Leader and its Minions.",
  approval: "Controls when guarded actions can ask to run outside the current sandbox. Always ask is strictest; Never ask rejects escalation instead of prompting.",
} as const;

const APPROVAL_OPTIONS = [
  { value: "always", label: "Always ask", description: "Use the strictest approval policy for guarded actions." },
  { value: "on-request", label: "On request", description: "Allow the agent to request approval for guarded actions." },
  { value: "on-failure", label: "On failure", description: "Allow approval requests after an action fails within the sandbox." },
  { value: "never", label: "Never ask", description: "Never ask rejects escalation instead of prompting." },
] as const;

function SandboxHelp({ axis, description }: { axis: string; description: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const dismiss = () => { restoreFocus.current = true; setOpen(false); };
  useLayoutEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    button.current?.focus({ preventScroll: true });
    // Native focus scrolling can leave the ring underneath fixed launch chrome.
    button.current?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="leader-sandbox-help-wrap" ref={root} onKeyDown={(event) => {
    if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); }
  }}>
    <button type="button" className="leader-sandbox-help" ref={button}
      aria-label={`About sandbox ${axis}`} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? dismiss() : setOpen(true)}>?</button>
    {open ? <section id={id} className="leader-sandbox-help-content" aria-label={`About sandbox ${axis}`}>
      <p>{description}</p>
      <button type="button" aria-label={`Close sandbox ${axis} help`} onClick={dismiss}>Close help</button>
    </section> : null}
  </div>;
}

export function SandboxPolicyControls({ policy, effective, support, disabled = false, mcpAvailable = false, onChange }: {
  policy?: SandboxPolicy | undefined;
  effective?: SandboxResolution | null | undefined;
  /** undefined while inventory loads; null means the harness does not enforce any axis. */
  support?: HarnessCapabilities["sandboxEnforcement"] | null | undefined;
  disabled?: boolean;
  mcpAvailable?: boolean;
  onChange: (policy: SandboxPolicy) => void;
}) {
  const value = policy ?? DEFAULT_SANDBOX_POLICY;
  const update = (patch: Partial<SandboxPolicy>) => onChange({ ...value, ...patch });
  const actual = effective?.effective;
  const id = useId();
  const access = SANDBOX_ACCESS_OPTIONS.find((option) => option.value === sandboxAccessValue(value))!;
  const approval = APPROVAL_OPTIONS.find((option) => option.value === value.approvalPolicy)!;
  const requestChanged = effective && (sandboxAccessValue(effective.requested) !== sandboxAccessValue(value)
    || effective.requested.approvalPolicy !== value.approvalPolicy);
  const resolvedAccess = effective && SANDBOX_ACCESS_OPTIONS.find((option) => option.value === sandboxAccessValue(effective.requested));
  const resolvedApproval = effective && APPROVAL_OPTIONS.find((option) => option.value === effective.requested.approvalPolicy);
  return (
    <fieldset className="leader-sandbox-policy">
      <legend>Execution sandbox</legend>
      <div className="leader-sandbox-axis">
        <label htmlFor={`${id}-files`}>Files</label>
        <SandboxHelp axis="file access" description={SANDBOX_HELP.filesystem} />
        {support === undefined || (support !== null && support.filesystem.length > 0) ? (
          <select id={`${id}-files`} disabled={disabled} aria-label="Sandbox file access" aria-describedby={`${id}-files-meaning`} value={sandboxAccessValue(value)}
            onChange={(event) => onChange(withSandboxAccess(value, event.target.value))}>
            {SANDBOX_ACCESS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}
                disabled={support !== undefined && (support === null || !support.filesystem.includes(option.filesystemScope))}>
                {option.label}
              </option>
            ))}
          </select>
        ) : <output id={`${id}-files`} aria-label="Sandbox file access">Unmanaged by harness</output>}
        <SelectedSetting id={`${id}-files-meaning`} label="Requested" value={access.label} description={access.description} />
      </div>
      <div className="leader-sandbox-axis">
        <label htmlFor={`${id}-approval`}>Approval</label>
        <SandboxHelp axis="approval policy" description={SANDBOX_HELP.approval} />
        {support === undefined || (support !== null && support.approval) ? (
          <select id={`${id}-approval`} disabled={disabled} aria-label="Sandbox approval policy" aria-describedby={`${id}-approval-meaning`} value={value.approvalPolicy}
            onChange={(event) => update({ approvalPolicy: event.target.value as SandboxPolicy["approvalPolicy"] })}>
            {APPROVAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : <output id={`${id}-approval`} aria-label="Sandbox approval policy">Unmanaged by harness</output>}
        <SelectedSetting id={`${id}-approval-meaning`} label="Requested" value={approval.label} description={approval.description} />
      </div>
      <small>
        Git change mode controls where edits land; this policy controls what the agent process can access.
      </small>
      {(support === null || (support?.filesystem.length === 0 && !support.approval)) && <small>
        This harness does not enforce these sandbox settings. Enabled editing tools can change files subject to host permissions and any configured extensions.
      </small>}
      {mcpAvailable && <div className="connection-approval-hint" role="status">
        <strong>Review MCP approvals</strong>
        <p>{support === null || support?.approval === false
          ? "This harness manages MCP permissions through its own permission mode. Check that it allows connection tools."
          : value.approvalPolicy === "never"
            ? "Never ask can block MCP tools that need permission. Choose On request to allow approval prompts."
            : "MCP tools may need approval. Your current policy permits approval prompts; confirm connection requests when asked."} External connections use their own access, separately from the file sandbox.</p>
        {value.approvalPolicy === "never" && support?.approval === true && <button type="button" disabled={disabled} onClick={() => update({ approvalPolicy: "on-request" })}>Allow MCP approval prompts</button>}
      </div>}
      {actual ? (
        <output className="leader-sandbox-effective">
          {requestChanged ? "Effective from last launch: " : "Effective: "}{actual.filesystemScope} · {actual.approvalPolicy}
          {effective.unsupported.length > 0 ? ` · unmanaged: ${effective.unsupported.join(", ")}` : ""}
          {requestChanged ? `. Resolved request: ${resolvedAccess?.label} · ${resolvedApproval?.label}. Changed request is not yet resolved.` : null}
          {(actual.filesystemScope === "unmanaged" || actual.approvalPolicy === "unmanaged")
            ? " Unmanaged axes are not enforced by this harness." : null}
        </output>
      ) : <p className="leader-sandbox-effective">Effective policy is resolved when the session starts.</p>}
    </fieldset>
  );
}
