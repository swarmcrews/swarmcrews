import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { HarnessInfo } from "../harness-list.ts";
import { buildLaunchModelGroups } from "./launch-models.ts";
import { MobileLeaderRuntimeControls } from "./MobileLeaderRuntimeControls.tsx";

const pi: HarnessInfo = {
  name: "pi", account: { provider: "pi" }, builtInTools: [], commands: [], agents: [],
  capabilities: { mutationInterception: "observe_only", thinking: true, promptCaching: true, mcp: false,
    permissionPrompts: false, resume: true, partialMessages: true, builtInFilesystem: true },
  models: [{ id: "native/reasoner", label: "Native reasoner", source: "dynamic", supportsReasoning: true,
    supportedEffortLevels: ["minimal", "xhigh", "max"] }],
};

describe("MobileLeaderRuntimeControls", () => {
  it.each(["xhigh", "max"] as const)("selects Pi Astra's %s effort above high", (effort) => {
    const astra: HarnessInfo = {
      ...pi,
      models: [{ id: "openai-codex/gpt-6-astra", label: "Codex Astra", source: "dynamic",
        supportsReasoning: true,
        supportedEffortLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] }],
    };
    const onThinkingOverrideChange = vi.fn();
    render(<MobileLeaderRuntimeControls harnesses={[astra]} modelGroups={buildLaunchModelGroups([astra])}
      modelValue="pi::openai-codex/gpt-6-astra" thinkingOverride={null} onModelChange={vi.fn()}
      onThinkingOverrideChange={onThinkingOverrideChange} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${effort}$`, "i") }));
    expect(onThinkingOverrideChange).toHaveBeenCalledWith({ enabled: true, effort, display: "summarized" });
  });

  it("renders every discovered Pi effort and sends the selected minimal level", () => {
    const onThinkingOverrideChange = vi.fn();
    render(<MobileLeaderRuntimeControls harnesses={[pi]} modelGroups={buildLaunchModelGroups([pi])}
      modelValue="pi::native/reasoner" thinkingOverride={null} onModelChange={vi.fn()}
      onThinkingOverrideChange={onThinkingOverrideChange} />);
    for (const label of ["Minimal", "XHigh", "Max"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "High" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimal" }));
    expect(onThinkingOverrideChange).toHaveBeenCalledWith({ enabled: true, effort: "minimal", display: "summarized" });
  });
});
