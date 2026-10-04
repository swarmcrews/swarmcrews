import { afterEach, describe, expect, it } from "vitest";
import { getCodexModels, setCodexModels } from "./models.ts";

afterEach(() => setCodexModels([]));

const model = { model: "native-reasoner", displayName: "Native reasoner" };

describe("Codex reasoning metadata", () => {
  it("preserves native effort choices and default without inventing levels", () => {
    const efforts = ["minimal", "low", "medium", "high", "xhigh", "max"];
    setCodexModels([{ ...model, defaultReasoningEffort: "high",
      supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort, description: "Native description" })),
    }]);
    expect(getCodexModels()).toEqual([expect.objectContaining({
      id: model.model, source: "dynamic", supportsReasoning: true,
      supportedEffortLevels: efforts, defaultEffortLevel: "high",
    })]);
  });

  it("keeps per-model subsets and future native effort names", () => {
    setCodexModels([{ ...model, defaultReasoningEffort: "future-level", supportedReasoningEfforts: [
      { reasoningEffort: "high" }, { reasoningEffort: "future-level" },
    ] }]);
    expect(getCodexModels()[0]).toMatchObject({ supportsReasoning: true,
      supportedEffortLevels: ["high", "future-level"], defaultEffortLevel: "future-level" });
  });

  it("ignores malformed effort entries and deduplicates valid choices in native order", () => {
    setCodexModels([{ ...model, defaultReasoningEffort: "low", supportedReasoningEfforts: [
      null, "low", {}, { reasoningEffort: 1 }, { reasoningEffort: "" },
      { reasoningEffort: " " }, { reasoningEffort: "high" }, { reasoningEffort: "high" },
    ] }]);
    expect(getCodexModels()[0]).toMatchObject({ supportsReasoning: true, supportedEffortLevels: ["high"] });
    expect(getCodexModels()[0]).not.toHaveProperty("defaultEffortLevel");
  });

  it("reports an explicit empty effort list as non-configurable", () => {
    setCodexModels([{ ...model, supportedReasoningEfforts: [], defaultReasoningEffort: "high" }]);
    expect(getCodexModels()[0]).toMatchObject({ supportsReasoning: false, supportedEffortLevels: [] });
    expect(getCodexModels()[0]).not.toHaveProperty("defaultEffortLevel");
  });

  it.each([undefined, null, "high", {}])("does not infer support from missing or malformed metadata: %j", efforts => {
    setCodexModels([{ ...model, supportedReasoningEfforts: efforts, defaultReasoningEffort: "high" }]);
    expect(getCodexModels()[0]).not.toHaveProperty("supportedEffortLevels");
    expect(getCodexModels()[0]).not.toHaveProperty("supportsReasoning");
    expect(getCodexModels()[0]).not.toHaveProperty("defaultEffortLevel");
  });
});
