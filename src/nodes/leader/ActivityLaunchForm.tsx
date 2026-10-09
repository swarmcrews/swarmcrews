import { SkillIcon } from "../../components/SkillIcon.tsx";
import { useContext, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  Settings2,
  Sparkles,
} from "lucide-react";
import { DEFAULT_THINKING_CONFIG } from "../../types.ts";
import { findHarness } from "../../harness-list.ts";
import { getModelCapability } from "../../model-meta.ts";
import { getPickableSkills, getSkill } from "../../skills/registry.ts";
import type { SkillTemplate } from "../../skills/types.ts";
import { useHarnessList } from "../../use-harness-list.tsx";
import { ModelSelectionMenu, type PermissionMode } from "../../components/SessionToolbar.tsx";
import { PromptAttachmentsContext } from "./prompt/use-prompt-attachments.ts";
import { LeaderPromptBar } from "./prompt/LeaderPromptBar.tsx";
import type { SlashCommand } from "./prompt/slash-commands.ts";
import type { LeaderData } from "./types.ts";
import { SandboxPolicyControls } from "./SandboxPolicyControls.tsx";
import { LaunchRunSummary } from "../../components/LaunchRunSummary.tsx";
import { SelectedSetting } from "./SelectedSetting.tsx";

const PERMISSIONS: Array<{ value: PermissionMode; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Approve safe operations" },
  { value: "default", label: "Ask", description: "Confirm risky operations" },
  { value: "acceptEdits", label: "Auto-edit", description: "Approve file edits" },
  { value: "plan", label: "Plan", description: "Require plan approval" },
  { value: "bypassPermissions", label: "Bypass", description: "Skip permission checks" },
];

const PROMPT_STARTERS = [
  {
    label: "Review",
    value: "Review the recent changes, identify risks, and recommend the next safest action.",
  },
  {
    label: "Fix",
    value: "Investigate the issue, isolate the root cause, and make the smallest reliable fix.",
  },
  {
    label: "Build",
    value: "Implement the requested feature end to end, including focused verification.",
  },
] as const;

function SkillVariables({
  skill,
  values,
  onChange,
}: {
  skill: SkillTemplate;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  if (skill.variables.length === 0) return null;
  return (
    <div className="leader-launch-skill-vars">
      {skill.variables.map((variable) => {
        const value = values[variable.name] ?? variable.defaultValue ?? "";
        const id = `leader-launch-skill-${skill.id}-${variable.name}`;
        return (
          <label key={variable.name} htmlFor={id}>
            <span>{variable.label} <small>{variable.required ? "Required" : "Optional"}</small></span>
            {variable.type === "select" ? (
              <select id={id} required={variable.required} value={value} onChange={(event) => onChange(variable.name, event.target.value)}>
                <option value="">Select an option…</option>
                {(variable.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : variable.type === "textarea" ? (
              <textarea
                id={id}
                required={variable.required}
                rows={2}
                value={value}
                placeholder={variable.placeholder}
                onChange={(event) => onChange(variable.name, event.target.value)}
              />
            ) : (
              <input
                id={id}
                required={variable.required}
                value={value}
                placeholder={variable.placeholder}
                onChange={(event) => onChange(variable.name, event.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

export function ActivityLaunchForm({
  nodeId,
  data,
  input,
  slashCommands,
  promptPlaceholder,
  submitDisabled,
  submitActive,
  pending = data.status === "creating",
  unavailableReason,
  textareaRef,
  workspaceControl,
  connectionsControl,
  onInputChange,
  onKeyDown,
  onSubmit,
  onUpdate,
}: {
  nodeId: string;
  data: LeaderData;
  input: string;
  slashCommands: SlashCommand[];
  promptPlaceholder: string;
  submitDisabled: boolean;
  submitActive: boolean;
  pending?: boolean;
  unavailableReason?: string | undefined;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  workspaceControl?: ReactNode;
  connectionsControl?: ReactNode;
  onInputChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onSubmit: () => void;
  onUpdate: (patch: Partial<LeaderData>) => void;
}) {
  const { harnesses, loaded: harnessesLoaded } = useHarnessList();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const activeHarnessName = data.harness ?? "claude";
  const activeModel = data.model ?? "opus";
  const activeHarness = findHarness(harnesses, activeHarnessName);
  const capability = getModelCapability(activeModel, activeHarness);
  const availableSkills = getPickableSkills();
  const selectedSkills = (data.skillIds ?? [])
    .map((id) => getSkill(id))
    .filter((skill): skill is SkillTemplate => skill !== undefined);
  // Codex's provider-neutral sandbox policy is its sole launch authority.
  // Keep legacy permissionMode in stored payloads for compatibility, but do
  // not present a second approval control that can disagree with it.
  const permissionOptions = activeHarnessName === "codex"
    || (activeHarness !== undefined && !activeHarness.capabilities.permissionPrompts)
    ? [] : PERMISSIONS;
  const selectedPermission = permissionOptions.find((option) => option.value === (data.permissionMode ?? "auto"));
  const orchestrationMeaning = data.orchestrationMode === "plan"
    ? "Graph — review before start" : "Graph — auto-start safe work";
  const selectedModel = activeHarness?.models.find((model) => model.id === activeModel);
  const thinkingConfig = data.thinkingConfig ?? DEFAULT_THINKING_CONFIG;
  const missingVariable = selectedSkills.some((skill) => skill.variables.some((variable) =>
    variable.required && !(data.skillValues?.[skill.id]?.[variable.name]
      ?? variable.defaultValue ?? "").trim()));
  const attachments = useContext(PromptAttachmentsContext);
  const readiness = pending ? "Starting leader…" : unavailableReason
    || (missingVariable ? "Complete required skill inputs" : !input.trim() && !attachments?.items.length ? "Describe a goal to launch"
      : !harnessesLoaded ? "Checking model availability…"
      : !activeHarness || !selectedModel ? "Selected model unavailable"
      : submitDisabled ? "Launch unavailable" : "Ready to launch");
  const ready = readiness === "Ready to launch";

  function updateSkill(id: string, checked: boolean) {
    const skillIds = checked
      ? [...new Set([...(data.skillIds ?? []), id])]
      : (data.skillIds ?? []).filter((skillId) => skillId !== id);
    const skillValues = { ...(data.skillValues ?? {}) };
    if (!checked) delete skillValues[id];
    onUpdate({ skillIds, skillValues });
  }

  function updateSkillValue(skillId: string, name: string, value: string) {
    onUpdate({
      skillValues: {
        ...(data.skillValues ?? {}),
        [skillId]: { ...(data.skillValues?.[skillId] ?? {}), [name]: value },
      },
    });
  }

  return (
    <div className="leader-launch-form">
      <div className="leader-launch-layout">
        <section className="leader-launch-primary" aria-label="Define the work">
          <div className="leader-launch-work">
            <div className="leader-launch-section-head">
              <div>
                <h3>Define the work</h3>
                <p>Describe the outcome. You can steer the leader from Activity after launch.</p>
              </div>
              {connectionsControl}
            </div>

            <label className="leader-launch-field" htmlFor={`leader-launch-title-${nodeId}`}>
              <span>Name <small>Optional</small></span>
              <input
                id={`leader-launch-title-${nodeId}`}
                value={data.taskName ?? ""}
                placeholder="e.g. Repair the release workflow"
                onChange={(event) => onUpdate({ taskName: event.target.value || null })}
              />
            </label>

            <div className="leader-launch-prompt-meta">
              <div className="leader-launch-prompt-label">
                <span>Goal</span>
                <small>Type / for commands</small>
              </div>
              <div className="leader-launch-starters" aria-label="Prompt starters">
                {PROMPT_STARTERS.map((starter) => (
                  <button key={starter.label} type="button" onClick={() => onInputChange(starter.value)}>
                    {starter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="leader-launch-prompt">
              <LeaderPromptBar
                input={input}
                slashCommands={slashCommands}
                onInputChange={onInputChange}
                onKeyDown={(event) => {
                  if (!ready && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); return; }
                  onKeyDown(event);
                }}
                onSubmit={() => { if (ready) onSubmit(); }}
                placeholder={promptPlaceholder}
                submitLabel={pending ? "Starting leader…" : "Launch leader"}
                disabled={!ready}
                active={ready && submitActive}
                variant="overlay"
                portalSlashMenu
                showSubmit={false}
                autoFocus
                textareaRef={textareaRef}
              />
            </div>

            {selectedSkills.some(skill => skill.variables.length > 0) && (
              <section className="leader-launch-inputs" aria-label="Selected skill inputs">
                <h4>Skill inputs</h4>
                <p>Complete required inputs before launching.</p>
                {selectedSkills.filter(skill => skill.variables.length > 0).map(skill => (
                  <fieldset key={skill.id}>
                    <legend>{skill.name}</legend>
                    <SkillVariables skill={skill} values={data.skillValues?.[skill.id] ?? {}}
                      onChange={(name, value) => updateSkillValue(skill.id, name, value)} />
                  </fieldset>
                ))}
              </section>
            )}
            {data.error ? <div className="leader-launch-error" role="alert">{data.error}</div> : null}
            <footer className="leader-launch-footer">
              <span role="status" aria-label="Launch readiness" data-needs-input={missingVariable}>{readiness}</span>
              <button type="button" className="act-launch-btn" disabled={!ready}
                onClick={() => { if (ready) onSubmit(); }}>
                {pending ? "Starting leader…" : "Launch leader"}
              </button>
            </footer>
          </div>

          <aside className="leader-launch-config" aria-label="Run setup">
            <div className="leader-launch-settings-head">
              <span className="leader-launch-settings-title">
                <span className="leader-launch-settings-icon" aria-hidden>
                  <Settings2 size={15} strokeWidth={2} />
                </span>
                <span>
                  <strong>Run configuration</strong>
                  <small>Workspace, model and access first</small>
                </span>
              </span>
            </div>

            <section className="leader-launch-workspace-section" aria-label="Workspace and isolation">
              {workspaceControl}
            <label className="leader-launch-toggle">
              <input
                type="checkbox"
                aria-label="Isolated worktree"
                checked={data.worktreeIsolation ?? false}
                onChange={(event) => onUpdate({ worktreeIsolation: event.target.checked })}
              />
              <span>
                <strong>Isolated worktree</strong>
                <small>Keep this task's edits separate until review.</small>
              </span>
            </label>

            </section>

            <div className="leader-launch-field">
              <span>Model</span>
              <ModelSelectionMenu
                model={activeModel}
                activeHarnessName={activeHarnessName}
                activeHarness={activeHarness}
                harnesses={harnesses.filter((harness) => harness.models.length > 0)}
                modelOptions={activeHarness?.models.map((model) => model.id) ?? []}
                modelLabels={Object.fromEntries(activeHarness?.models.map((model) => [model.id, model.label]) ?? [])}
                capability={capability}
                thinkingConfig={thinkingConfig}
                onModelChange={(model) => onUpdate({ harness: activeHarnessName, model })}
                onHarnessChange={(harness, model) => {
                  if (model) onUpdate({ harness, model });
                }}
                onThinkingConfigChange={(config) => onUpdate({ thinkingConfig: config })}
                hasSession={false}
                open={modelPickerOpen}
                onToggle={() => setModelPickerOpen((open) => !open)}
                layout="inline"
                fullWidth
                triggerLabel="Model"
                showThinkingToggle
              />
            </div>

            <div className="leader-launch-config-grid">
              {permissionOptions.length > 0 ? (
                <label className="leader-launch-field">
                  <span>Permissions</span>
                  <select
                    aria-label="Permissions"
                    aria-describedby={`leader-permission-meaning-${nodeId}`}
                    value={data.permissionMode ?? "auto"}
                    onChange={(event) => onUpdate({ permissionMode: event.target.value as PermissionMode })}
                  >
                    {permissionOptions.map((permission) => (
                      <option key={permission.value} value={permission.value}>
                        {permission.label} — {permission.description}
                      </option>
                    ))}
                  </select>
                  {selectedPermission ? <SelectedSetting id={`leader-permission-meaning-${nodeId}`}
                    value={`${selectedPermission.label} — ${selectedPermission.description}`} /> : null}
                </label>
              ) : null}

            </div>

            <SandboxPolicyControls
              mcpAvailable={(data.connectionIds?.length ?? 0) > 0}
              policy={data.sandboxPolicy}
              effective={data.effectiveSandboxPolicy}
              support={harnessesLoaded
                ? activeHarness?.capabilities.sandboxEnforcement ?? null
                : undefined}
              onChange={(sandboxPolicy) => onUpdate({ sandboxPolicy })}
            />

            <LaunchRunSummary model={`${selectedModel?.label ?? activeModel} · ${activeHarnessName}`}
              changeMode={data.worktreeIsolation ? "worktree" : "live"} policy={data.sandboxPolicy}
              effective={data.effectiveSandboxPolicy} orchestration={orchestrationMeaning} skills={selectedSkills.length}
              reasoning={capability.supportsAdaptiveThinking ? (thinkingConfig.enabled ? thinkingConfig.effort : "Off") : "Unavailable"} />

            <details className="leader-launch-advanced">
              <summary>Orchestration &amp; skills</summary>
              <div className="leader-launch-advanced-body">
                <div className="leader-launch-config-grid">
              <label className="leader-launch-field">
                <span>Orchestration</span>
                <select aria-label="Orchestration"
                  aria-describedby={`leader-orchestration-meaning-${nodeId}`}
                  value={data.orchestrationMode === "plan" ? "plan" : "auto"}
                  onChange={(event) => onUpdate({ orchestrationMode:
                    event.target.value as NonNullable<LeaderData["orchestrationMode"]> })}>
                  <option value="auto">Graph — auto-start safe work</option>
                  <option value="plan">Graph — review before start</option>
                </select>
                <SelectedSetting id={`leader-orchestration-meaning-${nodeId}`} value={orchestrationMeaning} />
              </label>

                </div>
            <section className="leader-launch-skills" aria-labelledby={`leader-launch-skills-${nodeId}`}>
              <div className="leader-launch-skills-head">
                <span>
                  <Sparkles size={14} aria-hidden />
                  <span>
                    <strong id={`leader-launch-skills-${nodeId}`}>Skills</strong>
                    <small>Arm this leader with focused instructions.</small>
                  </span>
                </span>
                <span className="leader-launch-skills-count">{selectedSkills.length} selected</span>
              </div>
              {availableSkills.length === 0 ? (
                <p className="leader-launch-empty-skills">No project skills available.</p>
              ) : (
                <div className="leader-launch-skill-list">
                  {availableSkills.map((skill) => {
                    const selected = (data.skillIds ?? []).includes(skill.id);
                    return (
                      <div className="leader-launch-skill" data-selected={selected} key={skill.id}>
                        <label title={skill.description}>
                          <input
                            type="checkbox"
                            aria-description={skill.description}
                            checked={selected}
                            onChange={(event) => updateSkill(skill.id, event.target.checked)}
                          />
                          <span className="leader-launch-skill-icon" aria-hidden><SkillIcon skill={skill} /></span>
                          <span>
                            <strong>{skill.name}</strong>
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
              </div>
            </details>
          </aside>
        </section>
      </div>
    </div>
  );
}
