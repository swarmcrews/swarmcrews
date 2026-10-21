import { describe, expect, it } from "vitest";
import { missingSkillInputs } from "./required-inputs.ts";
import type { SkillTemplate } from "./types.ts";

const skill: SkillTemplate = { id: "test", name: "Test", description: "", category: "code", icon: "", accentColor: "",
  template: "{{target}} {{mode}} {{notes}}", variables: [
    { name: "target", label: "Target", type: "text", required: true },
    { name: "mode", label: "Mode", type: "select", required: true, defaultValue: "safe" },
    { name: "notes", label: "Notes", type: "textarea" },
  ] };

describe("missingSkillInputs", () => {
  it("lists only unfilled required inputs, respecting defaults", () => {
    expect(missingSkillInputs(skill).map(field => field.name)).toEqual(["target"]);
    expect(missingSkillInputs(skill, { target: "src" })).toEqual([]);
  });
  it("treats whitespace and explicitly cleared defaults as missing", () => {
    expect(missingSkillInputs(skill, { target: "  ", mode: "" }).map(field => field.name)).toEqual(["target", "mode"]);
  });
});
