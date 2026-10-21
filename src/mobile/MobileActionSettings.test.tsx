import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileActionSettings } from "./MobileActionSettings.tsx";
import { clearSkills, registerSkill } from "../skills/registry.ts";
import type { SkillTemplate } from "../skills/types.ts";

const skill: SkillTemplate = { id: "phone-project-skill", name: "Phone project skill", description: "Project-specific guidance", category: "general", icon: "P", accentColor: "#123456", template: "Task instructions", variables: [] };
afterEach(() => { vi.unstubAllGlobals(); clearSkills(); });

describe("mobile context action Skills", () => {
  it("tags this project's Skills without exposing a different project's registry", async () => {
    registerSkill({ ...skill, id: "foreign-skill", name: "Foreign project skill" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([skill])));
    const save = vi.fn();
    render(<MobileActionSettings projectId="phone-project" settings={{}} onSettingsChange={save} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open skill picker" }));
    expect(screen.queryByRole("checkbox", { name: /Foreign project skill/ })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Phone project skill/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ dashboardLeaderActions: expect.arrayContaining([
      expect.objectContaining({ skillIds: [skill.id] }),
    ]) }));
  });

  it("offers a retry when project Skills cannot be loaded", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("Skills unavailable")).mockResolvedValue(Response.json([]));
    vi.stubGlobal("fetch", fetch);
    render(<MobileActionSettings projectId="phone-project" settings={{}} onSettingsChange={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Skills unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading Skills" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Prompt" })).toBeInTheDocument());
  });
});
