import { describe, expect, it } from "vitest";
import { reduceClaudeSession } from "./claude-session-recovery.ts";
import type { ClaudeSessionData } from "./ClaudeSessionNode.tsx";
import { DEFAULT_THINKING_CONFIG } from "../types.ts";

function initial(): ClaudeSessionData {
  return { sessionKey: "s", status: "idle", messages: [], totalCost: 0, turns: 0,
    error: null, model: "sonnet", permissionMode: "bypassPermissions", thinkingConfig: DEFAULT_THINKING_CONFIG,
    streamingText: "", subagents: [], promptSuggestions: [], lastDurationMs: null, initData: null };
}
describe("Claude replay projection", () => {
  it("acknowledges filtered banner rows while retaining controls and native metadata", () => {
    const state = { ...initial(), historyHighWater: 4, initData: { marker: "retained" } };
    const next = reduceClaudeSession(state, { type: "sync_response", sessionKey: "s", found: true,
      afterHistoryId: 4, history: { highWater: 5, before: null, nextAfter: null, url: "/api/history/s" },
      events: [{ type: "sdk_event", sessionKey: "s", timestamp: 5, historyId: 5,
        event: { kind: "thinking", text: "banner only" } }] });
    expect(next.messages).toEqual([]);
    expect(next.historyHighWater).toBe(5);
    expect(next.model).toBe("sonnet");
    expect(next.initData).toEqual({ marker: "retained" });
  });
});
