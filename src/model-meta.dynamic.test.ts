import { describe, expect, it } from "vitest";
import { getModelCapability } from "./model-meta.ts";
import type { HarnessInfo } from "./harness-list.ts";
import { buildLaunchModelGroups } from "./mobile/launch-models.ts";

const copilot: HarnessInfo = {
  name: "copilot", account: { provider: "github" }, builtInTools: [], commands: [], agents: [],
  capabilities: { mutationInterception: "observe_only", thinking: true, promptCaching: true, mcp: false,
    permissionPrompts: false, resume: true, partialMessages: true, builtInFilesystem: true },
  models: [{ id: "claude-sonnet-5", label: "Sonnet via Copilot", source: "dynamic",
    supportsReasoning: true, supportedEffortLevels: ["high", "future-level"] }],
};
describe("reported model capabilities", () => {
  it("prefers the selected harness's reported efforts over static vendor metadata", () => {
    expect(getModelCapability("claude-sonnet-5", copilot)).toEqual({ supportsAdaptiveThinking: true, supportedEffortLevels: ["high"] });
  });
  it("does not invent reasoning controls for dynamic models without supported efforts", () => {
    for (const model of [
      { id: "new", label: "New", source: "dynamic" as const },
      { id: "new", label: "New", supportsReasoning: false },
      { id: "new", label: "New", supportedEffortLevels: [] },
    ]) expect(getModelCapability("new", { ...copilot, models: [model] })).toEqual({ supportsAdaptiveThinking: false, supportedEffortLevels: [] });
  });
  it("preserves legacy harness behavior and respects harness capability limits", () => {
    expect(getModelCapability("sonnet").supportedEffortLevels).toEqual(["low", "medium", "high"]);
    expect(getModelCapability("claude-sonnet-5", { ...copilot, capabilities: { ...copilot.capabilities, thinking: false } }).supportsAdaptiveThinking).toBe(false);
  });
  it("uses Pi native metadata and never invents levels when discovery is incomplete", () => {
    expect(getModelCapability("pi-model", { ...copilot, name: "pi", models: [
      { id: "pi-model", label: "Pi model", source: "dynamic", supportsReasoning: true },
    ] }).supportedEffortLevels).toEqual([]);
    expect(getModelCapability("pi-model", { ...copilot, name: "pi", models: [
      { id: "pi-model", label: "Pi model", source: "dynamic", supportsReasoning: true,
        supportedEffortLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] },
    ] }).supportedEffortLevels).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  });
  it("exposes Copilot alongside other harnesses in mobile launch choices", () => {
    expect(buildLaunchModelGroups([copilot])).toEqual([{ harness: "copilot", label: "GitHub Copilot", options: [
      { id: "claude-sonnet-5", label: "Sonnet via Copilot", harness: "copilot", value: "copilot::claude-sonnet-5" },
    ] }]);
  });
});
