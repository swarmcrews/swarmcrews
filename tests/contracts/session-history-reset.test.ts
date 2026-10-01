import { afterEach, describe, expect, it } from "vitest";
import { clearSessionEvents, closePersistDb, openPersistDb } from "../../server/session-persist.ts";
import { appendEvent } from "../../server/session-repo.ts";
import { readHistorySince } from "../../server/session-history.ts";
import { emptySessionStreamState, sessionStreamReducer } from "../../src/session-stream.ts";

const event = (text: string) => ({ type: "sdk_event", sessionKey: "s", timestamp: 1,
  event: { kind: "text" as const, role: "assistant" as const, text, id: text } });
afterEach(() => closePersistDb());

describe("cleared history reconnect contract", () => {
  it("replaces an offline transcript after clear even when new global row IDs surpass its cursor", () => {
    const db = openPersistDb(":memory:");
    const oldId = appendEvent(db, "s", "sdk_event", event("old"));
    const oldPage = readHistorySince(db, "s", 0);
    let state = sessionStreamReducer(emptySessionStreamState("s"), {
      type: "sync_response", sessionKey: "s", found: true, ...oldPage,
    }, "test");
    clearSessionEvents("s");
    const newId = appendEvent(db, "s", "sdk_event", event("new"));
    expect(newId).toBeGreaterThan(oldId);
    const recovery = readHistorySince(db, "s", oldId);
    expect(recovery.history.reset).toBe(true);
    state = sessionStreamReducer(state, { type: "sync_response", sessionKey: "s", found: true,
      afterHistoryId: oldId, ...recovery }, "test");
    expect(state.messages.map(message => message.content)).toEqual(["new"]);
    expect(state.historyHighWater).toBe(newId);
    // The reset is acknowledged; future pages remain incremental.
    expect(readHistorySince(db, "s", newId).history.reset).not.toBe(true);
  });

  it("resets an empty cleared log, survives another clear, and does not invalidate unrelated sessions", () => {
    const db = openPersistDb(":memory:");
    const oldId = appendEvent(db, "s", "sdk_event", event("old"));
    const otherId = appendEvent(db, "other", "sdk_event", { ...event("unrelated"), sessionKey: "other" });
    clearSessionEvents("s");
    expect(readHistorySince(db, "s", oldId).history.reset).toBe(true);
    expect(readHistorySince(db, "other", otherId).history.reset).not.toBe(true);
    clearSessionEvents("s");
    appendEvent(db, "s", "sdk_event", event("latest"));
    const recovery = readHistorySince(db, "s", oldId);
    expect(recovery.history.reset).toBe(true);
    expect(recovery.events.filter(row => row.event).map(row => row.event)).toEqual([event("latest").event]);
    expect(db.prepare("SELECT count(*) n FROM event_log WHERE session_key = 's' AND event_type = 'session_cleared'").get()).toEqual({ n: 1 });
  });
});
