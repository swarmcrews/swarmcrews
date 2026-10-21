import type { SkillTemplate } from "./types.ts";

/** Use the same effective values as prompt compilation and launch validation. */
export function missingSkillInputs(skill: SkillTemplate, values: Record<string, string> = {}) {
  return skill.variables.filter(variable => variable.required
    && !(values[variable.name] ?? variable.defaultValue ?? "").trim());
}
