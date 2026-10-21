import { useEffect, useRef, useState } from "react";
import { SkillRequirements, focusMissingSkillInput } from "../skills/SkillRequirements.tsx";
import { missingSkillInputs } from "../skills/required-inputs.ts";
import { SkillIcon } from "../components/SkillIcon.tsx";
import type { SkillTemplate } from "../skills/types.ts";

/**
 * LaunchSkillsPanel — a mobile bottom-sheet for arming a leader with skills
 * from the LaunchScreen. Browses the project's skill library grouped by
 * category, toggles selection, and configures each selected skill's variables.
 *
 * The mobile analogue of the desktop `SkillFlyout` (a floating split-panel).
 * Instead of an anchored flyout it slides up as a full-width sheet so it works
 * with a thumb on a phone.
 */

const SKILL_CATEGORIES: { key: SkillTemplate["category"]; label: string }[] = [
  { key: "code", label: "Code" },
  { key: "docs", label: "Docs" },
  { key: "testing", label: "Testing" },
  { key: "devops", label: "DevOps" },
  { key: "analysis", label: "Analysis" },
  { key: "design", label: "Design" },
  { key: "general", label: "General" },
];

export interface LaunchSkillsPanelProps {
  open: boolean;
  /** Every skill available in the current project's library. */
  availableSkills: SkillTemplate[];
  /** IDs of the skills currently armed for launch. */
  selectedSkillIds: string[];
  /** Per-skill variable values: `{ [skillId]: { [varName]: value } }`. */
  skillValues: Record<string, Record<string, string>>;
  onToggleSkill: (id: string) => void;
  onVarChange: (skillId: string, varName: string, value: string) => void;
  onClose: () => void;
}

export function LaunchSkillsPanel({
  open,
  availableSkills,
  selectedSkillIds,
  skillValues,
  onToggleSkill,
  onVarChange,
  onClose,
}: LaunchSkillsPanelProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  useEffect(() => { if (open) focusMissingSkillInput(sheetRef.current); }, [open]);
  useEffect(() => {
    if (!open || !pendingSkill || !selectedSkillIds.includes(pendingSkill)) return;
    focusMissingSkillInput(sheetRef.current, pendingSkill);
    setPendingSkill(null);
  }, [open, pendingSkill, selectedSkillIds]);
  if (!open) return null;

  const selectedSkills = selectedSkillIds
    .map((id) => availableSkills.find((s) => s.id === id))
    .filter((s): s is SkillTemplate => s !== undefined);

  const byCategory = SKILL_CATEGORIES.map((cat) => ({
    ...cat,
    skills: availableSkills.filter((s) => s.category === cat.key),
  })).filter((cat) => cat.skills.length > 0);

  return (
    <div
      className="mob-skills-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Skills"
      onClick={onClose}
    >
      <div ref={sheetRef} className="mob-skills-sheet" onClick={(event) => event.stopPropagation()}>
        <header className="mob-skills-head">
          <h2>Skills</h2>
          <button
            type="button"
            className="mob-skills-close"
            onClick={onClose}
            aria-label="Close skills"
          >
            ×
          </button>
        </header>

        <div className="mob-skills-body">
          <SkillRequirements skills={selectedSkills} values={skillValues}
            onConfigure={() => focusMissingSkillInput(sheetRef.current)} />
          {availableSkills.length === 0 ? (
            <p className="mob-muted">No skills in this project's library yet.</p>
          ) : (
            <>
              {selectedSkills.length > 0 ? (
                <section
                  className="mob-skills-config"
                  aria-label="Selected skill configuration"
                >
                  <span className="mob-skills-section-title">Configure</span>
                  {selectedSkills.map((skill) => (
                    <div className="mob-skill-config-card" key={skill.id}>
                      <div className="mob-skill-config-head">
                        <span className="mob-skill-icon" aria-hidden="true">
                          <SkillIcon skill={skill} />
                        </span>
                        <strong>{skill.name}</strong>
                      </div>
                      {skill.variables.length === 0 ? (
                        <p className="mob-muted">No configuration needed.</p>
                      ) : (
                        skill.variables.map((variable) => {
                          const value =
                            skillValues[skill.id]?.[variable.name] ??
                            variable.defaultValue ??
                            "";
                          const fieldId = `skill-${skill.id}-${variable.name}`;
                          const status = { "data-skill-input": skill.id, "aria-required": variable.required || undefined,
                            "aria-invalid": variable.required && !value.trim() || undefined };
                          return (
                            <label className="mob-skill-var" key={variable.name} htmlFor={fieldId}>
                              <span>
                                {variable.label}
                                {variable.required ? (
                                  <em className="mob-skill-var-req"> Required</em>
                                ) : null}
                              </span>
                              {variable.type === "select" ? (
                                <select
                                  {...status}
                                  id={fieldId}
                                  value={value}
                                  onChange={(event) =>
                                    onVarChange(skill.id, variable.name, event.currentTarget.value)
                                  }
                                >
                                  <option value="">Select an option…</option>
                                  {(variable.options ?? []).map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              ) : variable.type === "textarea" ? (
                                <textarea
                                  {...status}
                                  id={fieldId}
                                  value={value}
                                  rows={2}
                                  placeholder={variable.placeholder}
                                  onChange={(event) =>
                                    onVarChange(skill.id, variable.name, event.currentTarget.value)
                                  }
                                />
                              ) : (
                                <input
                                  {...status}
                                  id={fieldId}
                                  type="text"
                                  value={value}
                                  placeholder={variable.placeholder}
                                  onChange={(event) =>
                                    onVarChange(skill.id, variable.name, event.currentTarget.value)
                                  }
                                />
                              )}
                              {variable.description ? (
                                <small className="mob-skill-var-help">{variable.description}</small>
                              ) : null}
                            </label>
                          );
                        })
                      )}
                    </div>
                  ))}
                </section>
              ) : null}

              <section className="mob-skills-browse" aria-label="Available skills">
                <span className="mob-skills-section-title">Add skills</span>
                {byCategory.map((cat) => (
                  <div className="mob-skills-cat" key={cat.key}>
                    <span className="mob-skills-cat-label">{cat.label}</span>
                    {cat.skills.map((skill) => {
                      const active = selectedSkillIds.includes(skill.id);
                      return (
                        <button
                          type="button"
                          key={skill.id}
                          className="mob-skill-row"
                          data-active={active}
                          aria-pressed={active}
                          onClick={() => {
                            onToggleSkill(skill.id);
                            if (!active && missingSkillInputs(skill, skillValues[skill.id]).length) setPendingSkill(skill.id);
                          }}
                        >
                          <span className="mob-skill-icon" aria-hidden="true">
                            <SkillIcon skill={skill} />
                          </span>
                          <span className="mob-skill-row-text">
                            <strong>{skill.name}</strong>
                            <small>{skill.description}</small>
                            {missingSkillInputs(skill, skillValues[skill.id]).length > 0 &&
                              <small className="skill-required-hint">{active ? "Required inputs incomplete" : "Requires setup after adding"}</small>}
                          </span>
                          <span className="mob-skill-row-mark" aria-hidden="true">
                            {active ? "✓" : "+"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </section>
            </>
          )}
        </div>

        <footer className="mob-skills-foot">
          <button type="button" className="mob-skills-done" onClick={onClose}>
            Done{selectedSkills.length > 0 ? ` (${selectedSkills.length})` : ""}
          </button>
        </footer>
      </div>
    </div>
  );
}
