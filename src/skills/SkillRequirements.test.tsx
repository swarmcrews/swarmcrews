import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SkillRequirements } from "./SkillRequirements.tsx";
import type { SkillTemplate } from "./types.ts";

it("names the missing requirements and offers recovery until they are resolved or removed", () => {
  const skills: SkillTemplate[] = [{ id: "review", name: "Review", description: "", icon: "", accentColor: "",
    category: "code", template: "{{target}}", variables: [{ name: "target", label: "Target", required: true, type: "text" }] }];
  const onConfigure = vi.fn();
  const view = render(<SkillRequirements skills={skills} values={{}} onConfigure={onConfigure} />);
  expect(screen.getByRole("status")).toHaveTextContent("Review: Target");
  fireEvent.click(screen.getByRole("button", { name: "Complete required skill inputs" }));
  expect(onConfigure).toHaveBeenCalledOnce();
  view.rerender(<SkillRequirements skills={skills} values={{ review: { target: "src" } }} onConfigure={onConfigure} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  view.rerender(<SkillRequirements skills={[]} values={{}} onConfigure={onConfigure} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
