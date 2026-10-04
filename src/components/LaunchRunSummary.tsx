import { DEFAULT_SANDBOX_POLICY, type SandboxPolicy, type SandboxResolution } from "../../shared/workspace-contracts.ts";
import { SANDBOX_ACCESS_OPTIONS, sandboxAccessValue } from "../sandbox-access.ts";
import "./launch-run-summary.css";

const APPROVAL_LABELS = { always: "Always ask", "on-request": "On request", "on-failure": "On failure", never: "Never ask" };
function requestedLabel(policy: SandboxPolicy) {
  return `${SANDBOX_ACCESS_OPTIONS.find(option => option.value === sandboxAccessValue(policy))?.label ?? policy.filesystemScope} · ${APPROVAL_LABELS[policy.approvalPolicy]}`;
}

/** Requested settings are a draft, never evidence of an enforced process boundary. */
export function LaunchRunSummary({ model, changeMode, policy = DEFAULT_SANDBOX_POLICY, effective, orchestration, skills, reasoning }: {
  model: string;
  changeMode: "live" | "worktree";
  policy?: SandboxPolicy | undefined;
  effective?: SandboxResolution | null | undefined;
  orchestration: string;
  skills: number;
  reasoning?: string | undefined;
}) {
  const changed = effective && (sandboxAccessValue(effective.requested) !== sandboxAccessValue(policy)
    || effective.requested.approvalPolicy !== policy.approvalPolicy);
  return <section className="launch-run-summary" aria-label="Launch summary">
    <h4>Before you launch</h4>
    <dl>
      <div><dt>Model</dt><dd>{model}</dd></div>
      <div><dt>Changes</dt><dd>{changeMode === "worktree" ? "Isolated worktree" : "Live working tree"}</dd></div>
      <div><dt>Requested access</dt><dd>{requestedLabel(policy)}</dd></div>
      <div><dt>{changed ? "Last effective access" : "Effective access"}</dt><dd>{effective
        ? `${effective.effective.filesystemScope} · ${effective.effective.approvalPolicy}${changed ? ". Changed request is not yet resolved." : ""}`
        : "Resolved when the session starts"}</dd></div>
    </dl>
    {changed && <p>Last resolved request: {requestedLabel(effective.requested)}</p>}
    <p>{orchestration}{reasoning ? ` · Reasoning: ${reasoning}` : ""} · {skills} {skills === 1 ? "skill" : "skills"}</p>
  </section>;
}
