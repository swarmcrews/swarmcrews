import type { SkillTemplate } from "./types.ts";
import { missingSkillInputs } from "./required-inputs.ts";
import "./skill-requirements.css";

/** A recovery action beside the blocked composer, not just a disabled send button. */
export function SkillRequirements({ skills, values, onConfigure }: {
  skills: SkillTemplate[];
  values: Record<string, Record<string, string>>;
  onConfigure: () => void;
}) {
  const missing = skills.flatMap(skill => {
    const fields = missingSkillInputs(skill, values[skill.id]);
    return fields.length ? [`${skill.name}: ${fields.map(field => field.label || field.name).join(", ")}`] : [];
  });
  if (!missing.length) return null;
  return <div className="skill-requirements">
    <div role="status"><strong>Required skill inputs</strong>
      {missing.map(item => <span key={item}>{item}</span>)}
    </div>
    <button type="button" onClick={onConfigure}>Complete required skill inputs</button>
  </div>;
}

/** Scope to the active editor; never jump into a different leader's inputs. */
export function firstMissingSkillInput(root: HTMLElement | null, skillId?: string) {
  return Array.from(root?.querySelectorAll<HTMLElement>('[data-skill-input][aria-invalid="true"]') ?? [])
    .find(element => skillId === undefined || element.dataset["skillInput"] === skillId);
}

export function focusMissingSkillInput(root: HTMLElement | null, skillId?: string) {
  const input = firstMissingSkillInput(root, skillId);
  input?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  input?.focus({ preventScroll: true });
}
