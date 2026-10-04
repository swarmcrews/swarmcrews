import { expect, it } from "vitest";
import { appendThinkingDelta, clearThinkingStream, EMPTY_THINKING_STREAM, thinkingStreamPatch } from "./thinking-stream.ts";

it("normalizes hydrated preview state and preserves references when clearing empty state", () => {
  expect(thinkingStreamPatch({})).toEqual(EMPTY_THINKING_STREAM);
  expect(clearThinkingStream(EMPTY_THINKING_STREAM)).toBe(EMPTY_THINKING_STREAM);
});

it("appends exact whitespace within a block, resets across blocks and isolates sub-agents", () => {
  const first = appendThinkingDelta(EMPTY_THINKING_STREAM, { kind: "thinking_delta", text: "I", blockIndex: 0 });
  expect(appendThinkingDelta(first, { kind: "thinking_delta", text: " need", blockIndex: 0 }).streamingThinkingText).toBe("I need");
  expect(appendThinkingDelta(first, { kind: "thinking_delta", text: "Next", blockIndex: 1 }).streamingThinkingText).toBe("Next");
  expect(appendThinkingDelta(first, { kind: "thinking_delta", text: "Nested", blockIndex: 0, parentId: "tool" })).toBe(first);
  expect(clearThinkingStream(first)).toEqual(EMPTY_THINKING_STREAM);
});

it("bounds the live thinking preview independently of transcript retention", () => {
  const state = appendThinkingDelta(EMPTY_THINKING_STREAM, { kind: "thinking_delta", text: "a".repeat(70000), blockIndex: 0 });
  expect(state.streamingThinkingText).toHaveLength(65536);
});
