import { afterEach, describe, expect, it } from "vitest";
import "./opencode/index.ts";
import "./pi/index.ts";
import "./claude/index.ts";
import "./codex/index.ts";
import { setClaudeModels } from "./claude/models.ts";
import { setCodexModels } from "./codex/models.ts";
import { modelPolicy, resolveLaunchModel } from "./model-policy.ts";
import { setOpenCodeModels } from "./opencode/models.ts";
import { setPiModels } from "./pi/models.ts";

afterEach(() => {
  setOpenCodeModels([]);
  setPiModels([]);
  setClaudeModels([]);
  setCodexModels([]);
});

describe("dynamic harness model policy", () => {
  it("resolves native Claude context modifiers before applying role preferences", () => {
    setClaudeModels([
      { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", description: "" },
      { value: "opus[1m]", resolvedModel: "claude-opus-5[1m]", displayName: "Opus", description: "" },
    ]);
    expect(resolveLaunchModel({ effectiveHarness: "claude", role: "leader" }))
      .toEqual({ model: "claude-opus-5[1m]", incompatible: false });
  });

  it("passes an advertised legacy Codex ID through unchanged at launch", () => {
    setCodexModels([{ id: "row", model: "gpt-5.4", displayName: "Native" }]);
    expect(resolveLaunchModel({ requestedHarness: "codex", effectiveHarness: "codex", requestedModel: "gpt-5.4", role: "leader" }))
      .toEqual({ model: "gpt-5.4", incompatible: false });
  });

  it.each(["claude", "codex"])("does not invent a %s model before discovery", (effectiveHarness) => {
    expect(resolveLaunchModel({ effectiveHarness, role: "leader" })).toBeNull();
  });

  it("uses discovered models as safe defaults for every executor class", () => {
    setPiModels([
      { id: "ollama/qwen-coder", label: "Qwen Coder" },
      { id: "openai/gpt-5.2", label: "GPT-5.2" },
    ]);
    expect(modelPolicy("pi")).toEqual({
      leader: ["ollama/qwen-coder", "openai/gpt-5.2"],
      minion: {
        mechanical: ["ollama/qwen-coder", "openai/gpt-5.2"],
        standard: ["ollama/qwen-coder", "openai/gpt-5.2"],
        reasoning: ["ollama/qwen-coder", "openai/gpt-5.2"],
      },
    });
  });

  it("accepts a model advertised by the selected harness even if another harness also knows it", () => {
    setOpenCodeModels([{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol via OpenCode" }]);
    expect(resolveLaunchModel({
      requestedHarness: "opencode",
      effectiveHarness: "opencode",
      requestedModel: "gpt-5.6-sol",
      role: "leader",
    })).toEqual({ model: "gpt-5.6-sol", incompatible: false });
  });
});
