import { describe, expect, it, vi } from "vitest";
import { createPiTranslator } from "./translate.ts";

describe("Pi event translation", () => {
  it("uses authoritative message text after incomplete deltas", () => {
    const translator = createPiTranslator("local/model", "fallback");
    translator.translate({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Partial" } });
    translator.translate({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Complete" }] } });
    translator.translate({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: " answer" }] } });
    expect(translator.result()).toBe("Complete answer");
  });

  it("reports retries without treating a truncated answer as completed", () => {
    const translator = createPiTranslator("local/model", "fallback");
    translator.ensureInit();
    expect(translator.translate({ type: "auto_retry_start", attempt: 2, errorMessage: "Overloaded" }))
      .toEqual([{ kind: "api_retry", attempt: 2, reason: "Overloaded" }]);
    translator.translate({ type: "message_end", message: { role: "assistant", stopReason: "length", content: [] } });
    expect(translator.translate({ type: "agent_end" }))
      .toEqual([expect.objectContaining({ kind: "done", reason: "error", error: expect.stringContaining("output limit") })]);
  });

  it("translates session, deltas, tools, usage, and completion", () => {
    vi.useFakeTimers();
    try {
      const translator = createPiTranslator("anthropic/claude-sonnet-4-5", "fallback", "auto");
      expect(translator.translate({ type: "session", id: "pi-session" })).toEqual([
        { kind: "init", sessionId: "pi-session", model: "anthropic/claude-sonnet-4-5", permissionMode: "auto" },
      ]);
      translator.translate({ type: "turn_start" });
      expect(translator.translate({ type: "message_update", assistantMessageEvent: {
        type: "text_delta", contentIndex: 0, delta: "Hello",
      } })).toEqual([{ kind: "text_delta", text: "Hello", blockIndex: 0 }]);
      expect(translator.translate({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "a.ts" } })).toEqual([
        { kind: "tool_call", id: "tool-1", name: "read", input: { path: "a.ts" } },
      ]);
      vi.advanceTimersByTime(1500);
      expect(translator.translate({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "read" })[0]).toMatchObject({
        kind: "tool_progress", id: "tool-1", elapsedSeconds: 1.5,
      });
      expect(translator.translate({ type: "message_end", message: {
        role: "assistant", content: [{ type: "text", text: "Hello" }],
        usage: { input: 5, output: 2, cacheRead: 1, cacheWrite: 0, cost: { total: 0.001 } },
      } })).toEqual([{ kind: "text", role: "assistant", text: "Hello" },
        { kind: "usage", source: "assistant", input: 5, output: 2,
        cacheRead: 1, cacheCreation: 0, costUSD: 0.001 }]);
      expect(translator.translate({ type: "agent_end", messages: [] })).toEqual([
        { kind: "done", reason: "completed", result: "Hello", turns: 1 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the final message when no deltas were emitted", () => {
    const translator = createPiTranslator("local/model", "fallback");
    expect(translator.translate({ type: "message_end", message: {
      role: "assistant", content: [{ type: "text", text: "Complete answer" }],
    } })).toEqual([
      { kind: "init", sessionId: "fallback", model: "local/model" },
      { kind: "text", role: "assistant", text: "Complete answer" },
    ]);
    expect(translator.result()).toBe("Complete answer");
  });
});

describe("Pi thinking streaming", () => {
  it("streams fragments separately and commits authoritative thinking once", () => {
    const translator = createPiTranslator("local/model", "fallback");
    translator.ensureInit();
    for (const delta of ["I", " need", " need", "\n time."]) {
      expect(translator.translate({ type: "message_update", assistantMessageEvent: {
        type: "thinking_delta", contentIndex: 0, delta,
      } })).toEqual([{ kind: "thinking_delta", text: delta, blockIndex: 0 }]);
    }
    expect(translator.translate({ type: "message_update", assistantMessageEvent: {
      type: "thinking_end", contentIndex: 0, content: "I need need\n time.",
    } })).toEqual([]);
    expect(translator.translate({ type: "message_end", message: {
      role: "assistant", content: [{ type: "thinking", thinking: "Authoritative thought" },
        { type: "text", text: "Answer" }],
    } })).toEqual([{ kind: "thinking", text: "Authoritative thought" },
      { kind: "text", role: "assistant", text: "Answer" }]);
    expect(translator.translate({ type: "agent_end" }).filter(event => event.kind === "thinking")).toEqual([]);
  });

  it("uses thinking_end snapshots as fallback and isolates consecutive messages", () => {
    const translator = createPiTranslator("local/model", "fallback");
    translator.ensureInit();
    translator.translate({ type: "message_update", assistantMessageEvent: {
      type: "thinking_delta", contentIndex: 2, delta: "Incomplete",
    } });
    translator.translate({ type: "message_update", assistantMessageEvent: {
      type: "thinking_end", contentIndex: 2, content: "Complete thought",
    } });
    expect(translator.translate({ type: "message_end", message: { role: "assistant", content: [] } }))
      .toEqual([{ kind: "thinking", text: "Complete thought" }]);
    expect(translator.translate({ type: "message_end", message: { role: "assistant", content: [
      { type: "thinking", thinking: "Next message" },
    ] } })).toEqual([{ kind: "thinking", text: "Next message" }]);
  });
});
