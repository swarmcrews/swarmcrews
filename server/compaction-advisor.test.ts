import { describe, expect, it } from "vitest";
import {
  DEFAULT_LARGE_CONTEXT_WINDOW_TOKENS,
  FALLBACK_CONTEXT_WINDOW_TOKENS,
  evaluateCompactionUsage,
  initialCompactionAdvisorState,
  contextWindowForModel,
} from "./compaction-advisor.ts";

describe("compaction advisor", () => {
  it("recommends once when usage crosses 55% of the model window", () => {
    const state = initialCompactionAdvisorState();

    expect(
      evaluateCompactionUsage(state, { kind: "usage", input: 109_999, contextTokens: 109_999, output: 0 }, "sonnet")?.action,
    ).toBe("none");
    expect(
      evaluateCompactionUsage(state, { kind: "usage", input: 110_000, contextTokens: 110_000, output: 0 }, "sonnet")?.action,
    ).toBe("recommend");
    expect(
      evaluateCompactionUsage(state, { kind: "usage", input: 120_000, contextTokens: 120_000, output: 0 }, "sonnet")?.action,
    ).toBe("none");
  });

  it("forces once at 80% of measured context occupancy", () => {
    const state = initialCompactionAdvisorState();

    expect(
      evaluateCompactionUsage(
        state,
        { kind: "usage", input: 100_000, cacheRead: 60_000, contextTokens: 160_000, output: 0 },
        "sonnet",
      )?.action,
    ).toBe("force");
    expect(
      evaluateCompactionUsage(
        state,
        { kind: "usage", input: 100_000, cacheRead: 80_000, contextTokens: 180_000, output: 0 },
        "sonnet",
      )?.action,
    ).toBe("none");
  });

  it.each(["turn_completed", "result", undefined] as const)("ignores billing-only %s usage", (source) => {
    const state = initialCompactionAdvisorState();
    expect(evaluateCompactionUsage(state, {
      kind: "usage", source, input: 80_963, cacheRead: 1_295_616, output: 14_727,
    }, "gpt-6-astra")).toBeNull();
    expect(state).toEqual(initialCompactionAdvisorState());
  });

  it("uses reported occupancy and window independently of cumulative billing", () => {
    const usage = { kind: "usage", source: "turn_completed", input: 80_963,
      cacheRead: 1_295_616, output: 14_727, contextTokens: 88_908,
      contextWindowTokens: 258_400 } as const;
    expect(evaluateCompactionUsage(initialCompactionAdvisorState(), usage, "gpt-6-astra"))
      .toMatchObject({ action: "none", contextTokens: 88_908, contextWindowTokens: 258_400 });
    expect(evaluateCompactionUsage(initialCompactionAdvisorState(), {
      ...usage, contextTokens: 210_000,
    }, "gpt-6-astra")?.action).toBe("force");
  });

  it("rearms after native compaction lowers occupancy", () => {
    const state = initialCompactionAdvisorState();
    const usage = { kind: "usage", input: 0, output: 0, contextTokens: 160_000 } as const;
    expect(evaluateCompactionUsage(state, usage, "sonnet")?.action).toBe("force");
    expect(evaluateCompactionUsage(state, { ...usage, contextTokens: 10_000 }, "sonnet")?.action).toBe("none");
    expect(evaluateCompactionUsage(state, usage, "sonnet")?.action).toBe("force");
  });

  it("uses a large local default for opus/fable-tier models and 200k fallback", () => {
    expect(contextWindowForModel("claude-opus-4-5")).toBe(DEFAULT_LARGE_CONTEXT_WINDOW_TOKENS);
    expect(contextWindowForModel("fable-5")).toBe(DEFAULT_LARGE_CONTEXT_WINDOW_TOKENS);
    expect(contextWindowForModel("gpt-6-astra")).toBe(DEFAULT_LARGE_CONTEXT_WINDOW_TOKENS);
    expect(contextWindowForModel("unknown-small")).toBe(FALLBACK_CONTEXT_WINDOW_TOKENS);
  });
});
