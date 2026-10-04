import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../shared/normalized-event.ts";
import { emptySessionStreamState, sessionStreamReducer, type SessionStreamState } from "./session-stream.ts";

const key = "thinking-stream";
function reduce(state: SessionStreamState, event: NormalizedEvent, historyId?: number) {
  return sessionStreamReducer(state, { type: "sdk_event", sessionKey: key, event, ...(historyId !== undefined ? { historyId } : {}) }, "pi");
}
const delta = (text: string, blockIndex = 0, parentId?: string): NormalizedEvent =>
  ({ kind: "thinking_delta", text, blockIndex, ...(parentId ? { parentId } : {}) });

describe("streaming thinking", () => {
  it("accumulates exact whitespace and repeated fragments without transcript messages", () => {
    let state = emptySessionStreamState(key);
    for (const text of ["I", " need", " need", "\n more time."]) state = reduce(state, delta(text));
    expect(state.streamingThinkingText).toBe("I need need\n more time.");
    expect(state.streamingThinkingBlockIndex).toBe(0);
    expect(state.streamingText).toBe("");
    expect(state.messages).toEqual([]);
  });

  it("keeps assistant and thinking buffers separate and resets on thinking block boundaries", () => {
    let state = reduce(emptySessionStreamState(key), { kind: "text_delta", text: "Answer", blockIndex: 0 });
    state = reduce(state, delta("First", 0));
    state = reduce(state, delta("Second", 1));
    expect(state.streamingThinkingText).toBe("Second");
    expect(state.streamingText).toBe("Answer");
    state = reduce(state, { kind: "thinking", text: "Second (complete)" });
    expect(state.streamingThinkingText).toBe("");
    expect(state.streamingThinkingBlockIndex).toBeNull();
    expect(state.streamingText).toBe("Answer");
    expect(state.messages.map(message => message.content)).toEqual(["Second (complete)"]);
  });

  it("ignores sub-agent thinking", () => {
    const state = emptySessionStreamState(key);
    expect(reduce(state, delta("Nested", 0, "agent-tool"))).toBe(state);
  });

  it.each([
    { kind: "stream_end" },
    { kind: "done", reason: "abort" },
    { kind: "done", reason: "error", error: "Failed" },
  ] as NormalizedEvent[])("clears unfinished thinking on $kind", event => {
    const state = reduce(reduce(emptySessionStreamState(key), delta("Unfinished")), event);
    expect(state.streamingThinkingText).toBe("");
    expect(state.streamingThinkingBlockIndex).toBeNull();
    expect(state.messages.filter(message => message.role === "thinking")).toEqual([]);
  });

  it("clears previews on terminal session status, errors, and clear", () => {
    const state = reduce(emptySessionStreamState(key), delta("Unfinished"));
    for (const message of [
      { type: "session_status" as const, sessionKey: key, status: "idle" as const },
      { type: "session_error" as const, sessionKey: key, error: "Failed" },
      { type: "session_cleared" as const, sessionKey: key },
    ]) expect(sessionStreamReducer(state, message, "pi").streamingThinkingText).toBe("");
  });

  it("replays completed thinking once and reconstructs an unfinished preview", () => {
    const events: NormalizedEvent[] = [delta("A"), delta(" thought"),
      { kind: "thinking", text: "A thought" }, delta("Next", 1)];
    let live = emptySessionStreamState(key);
    events.forEach((event, index) => { live = reduce(live, event, index + 1); });
    const replay = sessionStreamReducer(emptySessionStreamState(key), {
      type: "sync_response", sessionKey: key, found: true, status: "running",
      events: events.map((event, index) => ({ type: "sdk_event", sessionKey: key, event, historyId: index + 1, timestamp: 1 })),
    }, "pi");
    expect(replay.streamingThinkingText).toBe("Next");
    expect(replay.streamingThinkingText).toBe(live.streamingThinkingText);
    expect(replay.messages.map(message => message.content)).toEqual(["A thought"]);
  });
});

it("does not append replayed deltas twice or clear a newer live thinking block", () => {
  let live = reduce(emptySessionStreamState(key), delta("Old"), 1);
  live = reduce(live, { kind: "thinking", text: "Old" }, 2);
  live = reduce(live, delta("New", 1), 3);
  const replayRows = [delta("Old"), { kind: "thinking", text: "Old" }, delta("New", 1)].map((event, index) => ({
    type: "sdk_event", sessionKey: key, timestamp: 1, historyId: index + 1, event: event as NormalizedEvent,
  }));
  for (const events of [replayRows.slice(0, 2), replayRows.slice(2), replayRows]) {
    const replay = sessionStreamReducer(live, {
      type: "sync_response", sessionKey: key, found: true, status: "running", afterHistoryId: 0, events,
    }, "pi");
    expect(replay.streamingThinkingText).toBe("New");
    expect(replay.messages.map(message => message.content)).toEqual(["Old"]);
  }
});
