import { describe, expect, it } from "vitest";
import { buildModelGroups, normalizeThinkingConfig, resolveModelSelection } from "./settings-models.ts";

describe("shared settings model defaults", () => {
  it("preserves fallback inventories and canonicalizes saved model aliases", () => {
    const groups = buildModelGroups([], false);
    expect(resolveModelSelection("claude", "sonnet", groups)).toMatchObject({ harness: "claude", model: "claude-sonnet-5" });
    expect(resolveModelSelection("claude", "opus", groups)).toMatchObject({ harness: "claude", model: "claude-opus-4-8" });
    expect(resolveModelSelection("missing", "missing", groups)).toMatchObject({ harness: "claude", model: groups[0]!.options[0]!.model });
  });
  it("normalizes invalid saved reasoning options without losing valid fields", () => {
    const fallback = { enabled: true, effort: "high", display: "summarized" } as const;
    expect(normalizeThinkingConfig(null, fallback)).toEqual(fallback);
    expect(normalizeThinkingConfig({ enabled: false, effort: "invalid", display: "omitted" }, fallback))
      .toEqual({ enabled: false, effort: "high", display: "omitted" });
  });
});
