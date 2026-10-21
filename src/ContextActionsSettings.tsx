import { NavigationDraft } from "./navigation-drafts.tsx";
import { SkillIcon } from "./components/SkillIcon.tsx";
import { useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { ProjectSettings } from "./api.ts";
import {
  DASHBOARD_ACTION_ICONS,
  DEFAULT_DASHBOARD_ACTION_ICON,
  dashboardActionIcon,
  defaultDashboardLeaderActions,
  normalizeDashboardLeaderActions,
  type DashboardLeaderActionConfig,
} from "./dashboard-leader-actions.ts";
import { getPickableSkills } from "./skills/registry.ts";
import type { SkillTemplate } from "./skills/types.ts";
import { randomUuid } from "./random-id.ts";
import "./context-actions-settings.css";

export type SettingsSaveState = {
  status: "idle" | "saving" | "saved" | "error";
  error?: string;
};

interface ContextActionsSettingsProps {
  skills?: ReadonlyArray<SkillTemplate> | undefined;
  settings: ProjectSettings;
  onSettingsChange: (settings: ProjectSettings) => void;
  saveState?: SettingsSaveState | undefined;
  onRetrySave?: (() => void) | undefined;
}

type RecipeTransition = { kind: "select" | "remove"; id: string } | { kind: "create" | "restore" };

function newActionDraft(): DashboardLeaderActionConfig {
  return {
    id: randomUuid(),
    name: "",
    prompt: "",
    icon: DEFAULT_DASHBOARD_ACTION_ICON,
    skillIds: [],
  };
}

export function ContextActionsSettings({
  skills,
  settings,
  onSettingsChange,
  saveState = { status: "idle" },
  onRetrySave,
}: ContextActionsSettingsProps) {
  const actions = useMemo(() => normalizeDashboardLeaderActions(settings), [settings]);
  const [query, setQuery] = useState("");
  const [transition, setTransition] = useState<RecipeTransition | null>(null);
  const writeBlocked = saveState.status === "saving" || saveState.status === "error";
  const [sourceId, setSourceId] = useState<string | null>(() => actions[0]?.id ?? null);
  const [draft, setDraft] = useState<DashboardLeaderActionConfig>(() =>
    actions[0] ? cloneAction(actions[0]) : newActionDraft(),
  );
  const [validationVisible, setValidationVisible] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const actionSearchId = useId();
  const skillsHeadingId = useId();
  const skillPickerId = useId();
  const skillSearchId = useId();
  const availableSkills = useMemo(() => getPickableSkills(skills), [settings, skills]);
  const availableSkillIds = useMemo(
    () => new Set(availableSkills.map((skill) => skill.id)),
    [availableSkills],
  );
  const source = sourceId ? actions.find((action) => action.id === sourceId) : undefined;
  const dirty = sourceId === null
    ? Boolean(draft.name || draft.prompt || draft.skillIds.length || draft.icon !== DEFAULT_DASHBOARD_ACTION_ICON)
    : !source || source.id !== draft.id || source.name !== draft.name || source.prompt !== draft.prompt
      || source.icon !== draft.icon || source.skillIds.length !== draft.skillIds.length
      || source.skillIds.some((id, index) => id !== draft.skillIds[index]);

  useEffect(() => {
    if (sourceId === null || dirty) return;
    const refreshed = actions.find((action) => action.id === sourceId);
    if (refreshed) setDraft(cloneAction(refreshed));
  }, [actions, dirty, sourceId]);

  useEffect(() => {
    if (dirty || writeBlocked || sourceId === null || actions.some((action) => action.id === sourceId)) return;
    const fallback = actions[0];
    setSourceId(fallback?.id ?? null);
    setDraft(fallback ? cloneAction(fallback) : newActionDraft());
  }, [actions, sourceId, dirty, writeBlocked]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) => {
      const skillNames = action.skillIds
        .map((id) => availableSkills.find((skill) => skill.id === id)?.name ?? id)
        .join(" ");
      return `${action.name} ${action.prompt} ${skillNames}`.toLowerCase().includes(needle);
    });
  }, [actions, availableSkills, query]);
  const filteredSkills = useMemo(() => {
    const needle = skillQuery.trim().toLowerCase();
    if (!needle) return availableSkills;
    return availableSkills.filter((skill) =>
      `${skill.name} ${skill.description}`.toLowerCase().includes(needle),
    );
  }, [availableSkills, skillQuery]);

  const errors = {
    name: draft.name.trim() ? "" : "Name is required.",
    prompt: draft.prompt.trim() ? "" : "Instruction is required.",
  };
  const canApply = !errors.name && !errors.prompt && dirty;

  const commit = (next: DashboardLeaderActionConfig[]) => {
    const { dashboardLeaderActionNames, dashboardLeaderActionPrompts, ...rest } = settings;
    void dashboardLeaderActionNames;
    void dashboardLeaderActionPrompts;
    onSettingsChange({ ...rest, dashboardLeaderActions: next });
  };

  const chooseAction = (action: DashboardLeaderActionConfig) => {
    setSourceId(action.id);
    setDraft(cloneAction(action));
    setValidationVisible(false);
    setSkillsOpen(false);
    setSkillQuery("");
  };

  const addAction = () => {
    setSourceId(null);
    setDraft(newActionDraft());
    setValidationVisible(false);
    setSkillsOpen(false);
    setSkillQuery("");
  };

  const applyDraft = () => {
    setValidationVisible(true);
    if (!canApply || writeBlocked) return;
    setTransition(null);
    const nextAction: DashboardLeaderActionConfig = {
      ...draft,
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      skillIds: [...new Set(draft.skillIds.map((id) => id.trim()).filter(Boolean))],
    };
    const next = sourceId === null
      ? [...actions, nextAction]
      : actions.map((action) => action.id === sourceId ? nextAction : action);
    commit(next);
    setSourceId(nextAction.id);
    setDraft(cloneAction(nextAction));
    setValidationVisible(false);
    setSkillsOpen(false);
    setSkillQuery("");
    setAnnouncement(`${nextAction.name} applied.`);
  };

  const cancelDraft = () => {
    setTransition(null);
    if (source) {
      setDraft(cloneAction(source));
    } else {
      const fallback = actions[0];
      setSourceId(fallback?.id ?? null);
      setDraft(fallback ? cloneAction(fallback) : newActionDraft());
    }
    setValidationVisible(false);
    setSkillsOpen(false);
    setSkillQuery("");
  };

  const removeAction = (action: DashboardLeaderActionConfig) => {
    const next = actions.filter((candidate) => candidate.id !== action.id);
    commit(next);
    const fallback = next[0];
    setSourceId(fallback?.id ?? null);
    setDraft(fallback ? cloneAction(fallback) : newActionDraft());
    setSkillsOpen(false);
    setSkillQuery("");
    setAnnouncement(`${action.name} removed. ${next.length} actions remain.`);
  };

  const moveAction = (action: DashboardLeaderActionConfig, delta: number) => {
    if (query.trim() || writeBlocked) return;
    const index = actions.findIndex((candidate) => candidate.id === action.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= actions.length) return;
    const next = [...actions];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    commit(next);
    setAnnouncement(`${action.name} moved to position ${target + 1} of ${actions.length}.`);
  };

  const performTransition = (next: RecipeTransition) => {
    if (writeBlocked) return;
    setTransition(null);
    if (next.kind === "create") addAction();
    else if (next.kind === "restore") {
      const defaults = defaultDashboardLeaderActions();
      commit(defaults); chooseAction(defaults[0]!); setAnnouncement("Default actions restored.");
    } else if ("id" in next) {
      // Resolve by identity at confirmation time, not by stale presentation position.
      const target = actions.find(action => action.id === next.id);
      if (!target) { setAnnouncement("This recipe is no longer available. Your draft is retained."); return; }
      if (next.kind === "select") chooseAction(target); else removeAction(target);
    }
  };
  const requestTransition = (next: RecipeTransition) => {
    if (writeBlocked || (next.kind === "select" && next.id === sourceId)) return;
    if (dirty) setTransition(next); else performTransition(next);
  };

  const missingSkillIds = draft.skillIds.filter((id) => !availableSkillIds.has(id));
  const DraftIcon = dashboardActionIcon(draft.icon);

  return (
    <>
      <header className="settings-heading">
        <span className="settings-heading__meta">
          <span>Labs</span>
          <span className="settings-beta-badge">Beta</span>
        </span>
        <h2>Context actions</h2>
        <p>Create reusable Leader instructions and tag the Skills that should be armed when an action is selected.</p>
      </header>

      <NavigationDraft scope="context-actions" dirty={dirty} pending={saveState.status === "saving"} failed={saveState.status === "error"} />
      <section className="context-actions" aria-label="Action recipes">
        <aside className="context-actions__master">
          <div className="context-actions__master-head">
            <div>
              <strong>Action recipes</strong>
              <span>{actions.length} configured</span>
            </div>
            <button type="button" disabled={writeBlocked} onClick={() => requestTransition({ kind: "create" })} aria-label="Add action">
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="context-actions__search-bar">
            <input
              id={actionSearchId}
              className="context-actions__search-input"
              type="search"
              aria-label="Search actions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actions…"
            />
            {query && (
              <button
                type="button"
                className="context-actions__search-clear"
                onClick={() => setQuery("")}
                aria-label="Clear action search"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="context-actions__list" role="listbox" aria-label="Context actions">
            {filtered.length === 0 ? (
              <p>{actions.length === 0 ? "No actions configured." : "No matching actions."}</p>
            ) : filtered.map((action) => {
              const Icon = dashboardActionIcon(action.icon);
              const selected = sourceId === action.id;
              const position = actions.findIndex((candidate) => candidate.id === action.id);
              return (
                <div key={action.id} className="context-actions__row" data-selected={selected}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className="context-actions__row-main"
                    disabled={writeBlocked}
                    onClick={() => requestTransition({ kind: "select", id: action.id })}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>
                      <strong>{action.name}</strong>
                      <small>{action.skillIds.length} skill{action.skillIds.length === 1 ? "" : "s"}</small>
                    </span>
                  </button>
                  <span className="context-actions__row-controls">
                    <button type="button" aria-label={`Move ${action.name} up`} disabled={writeBlocked || Boolean(query.trim()) || position === 0} onClick={() => moveAction(action, -1)}><ChevronUp size={12} /></button>
                    <button type="button" aria-label={`Move ${action.name} down`} disabled={writeBlocked || Boolean(query.trim()) || position === actions.length - 1} onClick={() => moveAction(action, 1)}><ChevronDown size={12} /></button>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="context-actions__master-actions">
            <button type="button" disabled={writeBlocked} onClick={() => requestTransition({ kind: "create" })}><Plus size={13} /> Create action</button>
            <button type="button" disabled={writeBlocked} onClick={() => requestTransition({ kind: "restore" })}><RotateCcw size={13} /> Restore defaults</button>
          </div>
          {query.trim() && <small className="context-actions__filter-note">Clear search to reorder actions.</small>}
        </aside>

        <div className="context-actions__detail">
          <div className="context-actions__detail-head">
            <div className="context-actions__detail-title">
              <span className="context-actions__detail-icon"><DraftIcon size={16} /></span>
              <div><strong>{sourceId === null ? "New action" : draft.name || "Untitled action"}</strong><small>{sourceId === null ? "Local draft" : dirty ? "Unsaved changes" : "Saved recipe"}</small></div>
            </div>
            {source && <button type="button" className="context-actions__delete" aria-label={`Remove ${source.name}`} disabled={writeBlocked} onClick={() => requestTransition({ kind: "remove", id: source.id })}><Trash2 size={14} /></button>}
          </div>

          <div className="context-actions__sections">
            <fieldset>
              <legend>Basics</legend>
              <label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Review changes" aria-invalid={validationVisible && Boolean(errors.name)} /></label>
              {validationVisible && errors.name && <span className="context-actions__error">{errors.name}</span>}
              <div className="context-actions__icons" role="radiogroup" aria-label="Action icon">
                {DASHBOARD_ACTION_ICONS.map(({ key, label, Icon }) => (
                  <button key={key} type="button" role="radio" aria-checked={draft.icon === key} aria-label={label} title={label} data-active={draft.icon === key} onClick={() => setDraft({ ...draft, icon: key })}><Icon size={14} /></button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Instruction</legend>
              <label>Prompt<textarea value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} rows={5} placeholder="Tell the Leader what to do when this action is selected…" aria-invalid={validationVisible && Boolean(errors.prompt)} /></label>
              {validationVisible && errors.prompt && <span className="context-actions__error">{errors.prompt}</span>}
              <small>This fills the composer; it never submits automatically.</small>
            </fieldset>

            <section
              className="context-actions__skills-section"
              data-open={skillsOpen}
              aria-labelledby={skillsHeadingId}
            >
              <div className="context-actions__skills-heading">
                <strong id={skillsHeadingId}>Skills</strong>
                <span>{draft.skillIds.length} selected</span>
              </div>
              <div className="context-actions__skills-summary">
                <div className="context-actions__selected-skills" aria-label="Selected skills">
                  {draft.skillIds.length === 0 ? (
                    <span className="context-actions__selected-empty">No skills selected</span>
                  ) : draft.skillIds.map((skillId) => {
                    const skill = availableSkills.find((candidate) => candidate.id === skillId);
                    return (
                      <span key={skillId} className="context-actions__skill-chip" data-missing={!skill}>
                        <span aria-hidden="true">{skill ? <SkillIcon skill={skill} /> : "?"}</span>
                        <strong>{skill?.name ?? skillId}</strong>
                      </span>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="context-actions__skills-toggle context-actions__apply"
                  aria-expanded={skillsOpen}
                  aria-controls={skillPickerId}
                  aria-label={skillsOpen ? "Close skill picker" : "Open skill picker"}
                  disabled={availableSkills.length === 0}
                  onClick={() => {
                    setSkillsOpen((open) => !open);
                    if (skillsOpen) setSkillQuery("");
                  }}
                >
                  {skillsOpen ? "Done" : draft.skillIds.length > 0 ? "Edit" : "Add"}
                </button>
              </div>
              {availableSkills.length === 0 && (
                <p className="context-actions__empty-skills">No Skills are available in this project.</p>
              )}
              {skillsOpen && availableSkills.length > 0 && (
                <div id={skillPickerId} className="context-actions__skill-picker">
                  <div className="context-actions__skill-filter">
                    <Search size={13} aria-hidden="true" />
                    <input
                      id={skillSearchId}
                      type="search"
                      aria-label="Search available skills"
                      value={skillQuery}
                      onChange={(event) => setSkillQuery(event.target.value)}
                      placeholder="Search available skills…"
                    />
                    <small>{filteredSkills.length} available</small>
                  </div>
                  <div className="context-actions__skills" role="group" aria-label="Available skills">
                    {filteredSkills.length === 0 ? (
                      <p className="context-actions__empty-skills">No matching Skills.</p>
                    ) : filteredSkills.map((skill) => {
                      const checked = draft.skillIds.includes(skill.id);
                      return <label key={skill.id} data-checked={checked}><input type="checkbox" checked={checked} onChange={() => setDraft({ ...draft, skillIds: checked ? draft.skillIds.filter((id) => id !== skill.id) : [...draft.skillIds, skill.id] })} /><span><SkillIcon skill={skill} /></span><span><strong>{skill.name}</strong><small>{skill.description}</small></span>{checked && <Check size={13} />}</label>;
                    })}
                  </div>
                </div>
              )}
              {missingSkillIds.length > 0 && (
                <div className="context-actions__missing" role="status">
                  <AlertTriangle size={13} />
                  <span>Unavailable Skills are retained but will not be armed: {missingSkillIds.join(", ")}</span>
                </div>
              )}
            </section>

            <fieldset className="context-actions__preview">
              <legend>Preview</legend>
              <strong><DraftIcon size={13} /> /{draft.name.trim().toLowerCase().replace(/\s+/g, "-") || "action"}</strong>
              <p>{draft.prompt.trim() || "Your action instruction will appear here."}</p>
              <small><Zap size={11} /> {draft.skillIds.length} tagged skill{draft.skillIds.length === 1 ? "" : "s"}</small>
            </fieldset>
          </div>

          {transition && <div role="alert" className="context-actions__error">
            <p>Unsaved recipe edits. Keep editing or explicitly discard them before continuing.</p>
            <button type="button" onClick={() => setTransition(null)}>Keep editing</button>
            <button type="button" disabled={writeBlocked} onClick={() => performTransition(transition)}>Discard edits and continue</button>
          </div>}
          <footer className="context-actions__footer">
            <span data-status={saveState.status} title={saveState.error}>
              {saveState.status === "saving" ? "Saving…" : saveState.status === "error" ? "Save failed" : saveState.status === "saved" ? "Saved" : dirty ? "Draft" : ""}
              {saveState.status === "error" && onRetrySave && <button type="button" onClick={onRetrySave}>Retry</button>}
            </span>
            <div><button type="button" onClick={cancelDraft} disabled={!dirty}>Cancel</button><button type="button" className="context-actions__apply" onClick={applyDraft} disabled={!dirty || writeBlocked}>Apply</button></div>
          </footer>
        </div>
      </section>
      <div className="context-actions__sr-only" aria-live="polite">{announcement}</div>
    </>
  );
}

function cloneAction(action: DashboardLeaderActionConfig): DashboardLeaderActionConfig {
  return { ...action, skillIds: [...action.skillIds] };
}
