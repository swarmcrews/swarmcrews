import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDisplayModels, displayModels, rememberDisplayModels } from "./catalog-discovery.ts";

describe("display-only catalog", () => {
  afterEach(() => { clearDisplayModels(); vi.useRealTimers(); });
  it("keeps bounded previous models when a native probe clears its authoritative catalog", () => {
    vi.useFakeTimers();
    const models = Array.from({ length: 300 }, (_, i) => ({ id: `model-${i}`, label: `Model ${i}` }));
    rememberDisplayModels("claude", models);
    expect(displayModels("claude", [])).toHaveLength(256);
    rememberDisplayModels("claude", []);
    expect(displayModels("claude", [models[0]!])).toEqual([models[0]]);
    vi.advanceTimersByTime(600_001);
    expect(displayModels("claude", [])).toEqual([]);
  });
});
