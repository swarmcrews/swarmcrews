import { CanvasLayoutControls } from "./CanvasLayoutControls.tsx";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSettings } from "./api.ts";
import { useTheme } from "./use-theme.ts";
import { useHarnessList } from "./use-harness-list.tsx";
import { findHarness } from "./harness-list.ts";
import { DEFAULT_THINKING_CONFIG, MINION_THINKING_CONFIG } from "./types.ts";
import { getModelCapability } from "./model-meta.ts";
import {
  ContextActionsSettings as ContextActionsRecipeSettings,
  type SettingsSaveState,
} from "./ContextActionsSettings.tsx";
import type { ServerMessage, SocketSubscribe } from "./use-socket.ts";
import {
  DEFAULT_SANDBOX_POLICY,
  SandboxPolicyControls,
} from "./nodes/leader/SandboxPolicyControls.tsx";
import { ModelSelectionMenu } from "./components/SessionToolbar.tsx";
import {
  MinionModelRoutingSettings,
  type MinionTier,
} from "./MinionModelRoutingSettings.tsx";
import { AgentRoleSettings, ToggleRow } from "./SettingsControls.tsx";
import "./settings-menu.css";
import type { SettingsCategory } from "./settings-categories.ts";
import { buildModelGroups, resolveModelSelection, normalizeThinkingConfig, normalizeThinkingForCapability } from "./settings-models.ts";
export interface SettingsPreferencesProps {
  skills?: ReadonlyArray<import("./skills/types.ts").SkillTemplate> | undefined;
  category: Exclude<SettingsCategory, "connections">;
  settings: ProjectSettings;
  onSettingsChange: (settings: ProjectSettings) => void;
  settingsSaveState?: SettingsSaveState | undefined;
  onRetrySettingsSave?: (() => void) | undefined;
  socketSend?: ((data: unknown) => void) | undefined;
  socketSubscribe?: SocketSubscribe | undefined;
}
interface SystemModelStatus {
  enabled: boolean;
  mode: "off" | "advisory" | "enforced";
  manifestFound: boolean;
  loadErrors: Array<{ file?: string; message?: string }>;
}
export function SettingsPreferences({
  skills,
  category: activeCategory,
  settings,
  onSettingsChange,
  settingsSaveState,
  onRetrySettingsSave,
  socketSend,
  socketSubscribe,
}: SettingsPreferencesProps) {
  const { themeId, setTheme, themes: allThemes } = useTheme();
  const { harnesses, loaded: harnessesLoaded } = useHarnessList();
  const [systemModelStatus, setSystemModelStatus] = useState<SystemModelStatus | null>(null);
  const [systemModelStatusUnavailable, setSystemModelStatusUnavailable] = useState(false);
  const modelGroups = useMemo(
    () => buildModelGroups(harnesses, harnessesLoaded),
    [harnesses, harnessesLoaded],
  );
  const modelMenuHarnesses = useMemo(
    () => harnesses.filter((harness) => harness.models.length > 0),
    [harnesses],
  );
  const modelLabels = useMemo(
    () => Object.fromEntries(
      modelGroups.flatMap((group) =>
        group.options.map((option) => [
          option.model,
          option.label.replace(` (${group.label})`, ""),
        ]),
      ),
    ),
    [modelGroups],
  );
  const leaderSelection = resolveModelSelection(
    settings.defaultLeaderHarness ?? "claude",
    settings.defaultLeaderModel ?? settings.defaultModel ?? "claude-opus-4-8",
    modelGroups,
  );
  const minionSelection = resolveModelSelection(
    settings.defaultMinionHarness ?? "claude",
    settings.defaultMinionModel ?? settings.defaultModel ?? "claude-sonnet-5",
    modelGroups,
  );
  const minionTierGroups = modelGroups.filter(
    (group) => group.harness === minionSelection.harness,
  );
  const minionTierSelections = {
    mechanical: resolveModelSelection(
      minionSelection.harness,
      settings.mechanicalMinionModel ?? minionSelection.model,
      minionTierGroups,
    ),
    standard: minionSelection,
    reasoning: resolveModelSelection(
      minionSelection.harness,
      settings.reasoningMinionModel ?? minionSelection.model,
      minionTierGroups,
    ),
  };
  const leaderHarness = findHarness(harnesses, leaderSelection.harness);
  const minionHarness = findHarness(harnesses, minionSelection.harness);
  const leaderThinking = normalizeThinkingConfig(
    settings.defaultLeaderThinkingConfig,
    DEFAULT_THINKING_CONFIG,
  );
  const minionThinking = normalizeThinkingConfig(
    settings.defaultMinionThinkingConfig,
    MINION_THINKING_CONFIG,
  );
  const leaderCapability = getModelCapability(leaderSelection.model, leaderHarness);

  const changeMinionTierModel = (tier: MinionTier, model: string) => {
    const next: ProjectSettings = { ...settings };
    if (tier === "mechanical") next.mechanicalMinionModel = model;
    if (tier === "standard") {
      next.defaultMinionModel = model;
      next.defaultMinionThinkingConfig = normalizeThinkingForCapability(
        minionThinking,
        getModelCapability(model, minionHarness),
      );
    }
    if (tier === "reasoning") next.reasoningMinionModel = model;
    onSettingsChange(next);
  };

  const changeMinionHarness = (harness: string, model?: string) => {
    if (!model) return;
    onSettingsChange({
      ...settings,
      defaultMinionHarness: harness,
      defaultMinionModel: model,
      mechanicalMinionModel: model,
      reasoningMinionModel: model,
      defaultMinionThinkingConfig: normalizeThinkingForCapability(
        minionThinking,
        getModelCapability(model, findHarness(harnesses, harness)),
      ),
    });
  };

  useEffect(() => {
    if (settings.systemModel === undefined || settings.systemModel === "off") {
      setSystemModelStatus(null);
      setSystemModelStatusUnavailable(false);
      return;
    }
    if (!socketSend || !socketSubscribe) {
      setSystemModelStatusUnavailable(true);
      return;
    }

    const requestId = `system-model-status-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let statusRequested = false;
    const unsubscribe = socketSubscribe("*", (msg: ServerMessage) => {
      if (msg.type === "session_list" && !statusRequested) {
        const session = msg.sessions.find((item) => item.role === "leader") ?? msg.sessions[0];
        if (!session) {
          setSystemModelStatusUnavailable(true);
          return;
        }
        statusRequested = true;
        socketSend({
          type: "get_system_model_status",
          sessionKey: session.sessionKey,
          requestId,
        });
        return;
      }
      if (
        msg.type !== "control_response"
        || msg.command !== "get_system_model_status"
        || msg.requestId !== requestId
      ) return;

      const status = msg["status"];
      if (!msg.success || !isSystemModelStatus(status)) {
        setSystemModelStatusUnavailable(true);
        return;
      }
      setSystemModelStatus(status);
      setSystemModelStatusUnavailable(false);
    });

    socketSend({ type: "list_sessions" });
    return unsubscribe;
  }, [settings.systemModel, socketSend, socketSubscribe]);

  return (
    <div className="settings-preferences">

          {activeCategory === "general" && (
            <>
              <SettingsHeading
                eyebrow="Personalize"
                title="General"
                description="Choose how Swarmcrews looks while you work."
              />
              <SettingsCard
                title="Appearance"
                description="Theme applies immediately across the application."
              >
                <div
                  className="settings-theme-grid"
                  role="group"
                  aria-label="Application themes, dark themes left and light themes right"
                >
                  <span className="settings-theme-grid__heading">Dark</span>
                  <span className="settings-theme-grid__heading">Light</span>
                  {allThemes.map((theme) => {
                    const isActive = theme.id === themeId;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        aria-pressed={isActive}
                        className="settings-theme"
                        data-tone={theme.tone}
                        onClick={() => setTheme(theme.id)}
                        title={theme.description}
                      >
                        <span
                          className="settings-theme__swatch"
                          style={{ background: theme.swatch.bg, borderColor: theme.swatch.accent }}
                        >
                          <span style={{ background: theme.swatch.accent }} />
                        </span>
                        <span>
                          <strong>{theme.name}</strong>
                          <small>{theme.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SettingsCard>
            </>
          )}

          {activeCategory === "agents" && (
            <>
              <SettingsHeading
                eyebrow="New sessions"
                title="Agent defaults"
                description="Choose the access policy and role defaults used when new sessions start."
              />
              <SettingsCard
                title="Session policy"
                description="Shared by new Leader and Minion sessions."
              >
                <FieldLabel>Default permission mode</FieldLabel>
                <Select
                  value={settings.defaultPermissionMode ?? "auto"}
                  onChange={(value) =>
                    onSettingsChange({ ...settings, defaultPermissionMode: value })
                  }
                  options={[
                    { value: "auto", label: "Auto (Safe Approve)" },
                    { value: "bypassPermissions", label: "Bypass Permissions" },
                    { value: "default", label: "Default (Ask)" },
                  ]}
                />
              </SettingsCard>

              <SettingsCard
                title="Role defaults"
                description="Set how each role starts. Changes apply to new sessions."
              >
                <div className="settings-agent-list">
                  <AgentRoleSettings
                    role="Leader"
                    description="Plans work, delegates tasks, and owns the outcome."
                  >
                    <ModelSelectionMenu
                      model={leaderSelection.model}
                      activeHarnessName={leaderSelection.harness}
                      activeHarness={leaderHarness}
                      harnesses={modelMenuHarnesses}
                      modelOptions={modelGroups
                        .find((group) => group.harness === leaderSelection.harness)
                        ?.options.map((option) => option.model) ?? []}
                      modelLabels={modelLabels}
                      capability={leaderCapability}
                      thinkingConfig={leaderThinking}
                      onModelChange={(model) =>
                        onSettingsChange({
                          ...settings,
                          defaultModel: model,
                          defaultLeaderHarness: leaderSelection.harness,
                          defaultLeaderModel: model,
                          defaultLeaderThinkingConfig: normalizeThinkingForCapability(
                            leaderThinking,
                            getModelCapability(model, leaderHarness),
                          ),
                        })
                      }
                      onHarnessChange={(harness, model) => {
                        if (!model) return;
                        onSettingsChange({
                          ...settings,
                          defaultModel: model,
                          defaultLeaderHarness: harness,
                          defaultLeaderModel: model,
                          defaultLeaderThinkingConfig: normalizeThinkingForCapability(
                            leaderThinking,
                            getModelCapability(model, findHarness(harnesses, harness)),
                          ),
                        });
                      }}
                      onThinkingConfigChange={(config) =>
                        onSettingsChange({
                          ...settings,
                          defaultLeaderThinkingConfig: normalizeThinkingForCapability(
                            config,
                            leaderCapability,
                          ),
                        })
                      }
                      hasSession={false}
                      expanded
                      triggerLabel="Leader model and reasoning"
                      showThinkingToggle
                    />
                  </AgentRoleSettings>
                  <AgentRoleSettings
                    role="Minion"
                    description="Executes focused tasks within the Leader's plan."
                  >
                    <MinionModelRoutingSettings
                      adaptive={settings.adaptiveMinionModelRouting === true}
                      activeHarnessName={minionSelection.harness}
                      activeHarness={minionHarness}
                      harnesses={modelMenuHarnesses}
                      modelOptions={modelGroups
                        .find((group) => group.harness === minionSelection.harness)
                        ?.options.map((option) => option.model) ?? []}
                      modelLabels={modelLabels}
                      selections={minionTierSelections}
                      thinkingConfig={minionThinking}
                      onAdaptiveChange={(adaptiveMinionModelRouting) =>
                        onSettingsChange({
                          ...settings,
                          adaptiveMinionModelRouting,
                          ...(adaptiveMinionModelRouting
                            ? {
                                defaultMinionModel: minionTierSelections.standard.model,
                                mechanicalMinionModel: minionTierSelections.mechanical.model,
                                reasoningMinionModel: minionTierSelections.reasoning.model,
                              }
                            : {}),
                        })
                      }
                      onTierModelChange={changeMinionTierModel}
                      onHarnessChange={changeMinionHarness}
                      onThinkingConfigChange={(config) =>
                        onSettingsChange({
                          ...settings,
                          defaultMinionThinkingConfig: normalizeThinkingForCapability(
                            config,
                            getModelCapability(minionSelection.model, minionHarness),
                          ),
                        })
                      }
                    />
                  </AgentRoleSettings>
                </div>
              </SettingsCard>

              <SettingsCard
                title="Execution sandbox"
                description="Filesystem and approval defaults for new Leader sessions. Unsupported controls are shown as unmanaged."
              >
                <SandboxPolicyControls
                  policy={settings.defaultSandboxPolicy ?? DEFAULT_SANDBOX_POLICY}
                  support={harnessesLoaded
                    ? leaderHarness?.capabilities.sandboxEnforcement ?? null
                    : undefined}
                  onChange={(defaultSandboxPolicy) =>
                    onSettingsChange({ ...settings, defaultSandboxPolicy })
                  }
                />
              </SettingsCard>

              <SettingsCard
                title="Role system"
                description="Beta prompt behavior for new Leader and Minion sessions."
              >
                <ToggleRow
                  label="Enable adaptive expert roles"
                  description="Let agents infer the smallest useful role contract, or refine a role supplied by you or the Leader."
                  checked={settings.roleSystemBeta === true}
                  onChange={(checked) =>
                    onSettingsChange({ ...settings, roleSystemBeta: checked })
                  }
                />
              </SettingsCard>
            </>
          )}

          {activeCategory === "workspace" && (
            <>
              <SettingsHeading
                eyebrow="Project behavior"
                title="Workspace"
                description="Control how new work is isolated and how the canvas stays organized."
              />
              <SettingsCard
                title="Source control"
                description="Keep concurrent changes separated until they are ready to review."
              >
                <ToggleRow
                  label="Isolate new Leader work"
                  description="Create a dedicated git worktree branch with approval-based merging."
                  checked={settings.defaultWorktreeIsolation !== false}
                  onChange={(checked) =>
                    onSettingsChange({ ...settings, defaultWorktreeIsolation: checked })
                  }
                />
              </SettingsCard>
              <SettingsCard
                title="Canvas layout"
                description="Keep spatial workflows legible as the project grows."
              >
                <CanvasLayoutControls settings={settings} onSettingsChange={onSettingsChange} />
              </SettingsCard>
            </>
          )}

          {activeCategory === "actions" && (
            <ContextActionsRecipeSettings
              skills={skills}
              settings={settings}
              onSettingsChange={onSettingsChange}
              saveState={settingsSaveState}
              onRetrySave={onRetrySettingsSave}
            />
          )}

          {activeCategory === "governance" && (
            <>
              <SettingsHeading
                eyebrow="Labs"
                title="Governance"
                beta
                description="Choose how the system model informs agents and protects merges."
              />
              <SettingsCard
                title="System model"
                description="Compile repository knowledge into Context Packs for Swarmcrews."
              >
                <div className="settings-mode-grid" role="radiogroup" aria-label="System model mode">
                  {([
                    ["off", "Off", "No model context or merge gates."],
                    ["advisory", "Advisory", "Share context without blocking merges."],
                    ["enforced", "Enforced", "Share context and block failed review gates."],
                  ] as const).map(([value, label, description]) => (
                    <label
                      key={value}
                      className="settings-mode"
                      data-active={(settings.systemModel ?? "off") === value}
                    >
                      <input
                        type="radio"
                        name="system-model-mode"
                        value={value}
                        checked={(settings.systemModel ?? "off") === value}
                        onChange={() =>
                          onSettingsChange({ ...settings, systemModel: value })
                        }
                      />
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </label>
                  ))}
                </div>
                <p className="settings-callout">
                  Requires <code>.systemmodel/manifest.yaml</code> in the worktree.
                </p>
                {settings.systemModel !== undefined
                  && settings.systemModel !== "off"
                  && (systemModelStatus?.manifestFound === false
                    || systemModelStatusUnavailable) && (
                    <div role="status" className="settings-status">
                      {systemModelStatus?.manifestFound === false
                        ? <>System model is enabled but inactive. Seed <code>.systemmodel/manifest.yaml</code>.</>
                        : <>For a new system model, seed <code>.systemmodel/manifest.yaml</code>.</>}
                    </div>
                  )}
              </SettingsCard>
            </>
          )}

    </div>
  );
}

function isSystemModelStatus(value: unknown): value is SystemModelStatus {
  if (typeof value !== "object" || value === null) return false;
  const status = value as Record<string, unknown>;
  return typeof status["enabled"] === "boolean"
    && (status["mode"] === "off" || status["mode"] === "advisory" || status["mode"] === "enforced")
    && typeof status["manifestFound"] === "boolean"
    && Array.isArray(status["loadErrors"]);
}

// ── Small layout helpers ────────────────────────────────────

function SettingsHeading({
  eyebrow,
  title,
  beta = false,
  description,
}: {
  eyebrow: string;
  title: string;
  beta?: boolean;
  description: string;
}) {
  return (
    <header className="settings-heading">
      <span className="settings-heading__meta">
        <span>{eyebrow}</span>
        {beta && <BetaBadge />}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-card">
      <div className="settings-card__heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="settings-card__body">{children}</div>
    </section>
  );
}

function BetaBadge() {
  return <span className="settings-beta-badge">Beta</span>;
}

function FieldLabel({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <label
      id={id}
      style={{
        display: "block",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 6,
      }}
    >
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        fontSize: 12,
        color: "var(--text-secondary)",
        padding: "6px 10px",
        background: "var(--bg-primary)",
        border: "1px solid var(--border-primary)",
        borderRadius: 4,
        fontFamily: "var(--font-mono)",
        cursor: "pointer",
        outline: "none",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
