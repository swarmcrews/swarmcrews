import { describe, expect, it } from "vitest";
import { modelVersionLabel } from "./model-label.ts";

describe("modelVersionLabel", () => {
  it.each([
    ["claude-sonnet-4-5-20250929", "Sonnet", "Sonnet (claude-sonnet-4-5-20250929)"],
    ["claude-opus-4-6[1m]", "Opus", "Opus (claude-opus-4-6[1m])"],
    ["gpt-5.4", "GPT", "GPT (gpt-5.4)"],
    ["gpt-5.4", "gpt-5.4", "gpt-5.4"],
    ["gpt-5.4", undefined, "gpt-5.4"],
    ["gpt-5.4", "  ", "gpt-5.4"],
    ["sonnet", "Sonnet", "Sonnet (sonnet)"],
  ])("labels %s without inventing or duplicating a version", (id, name, expected) => {
    expect(modelVersionLabel(id, name)).toBe(expected);
  });
});
