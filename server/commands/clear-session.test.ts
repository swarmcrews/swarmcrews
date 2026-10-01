import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearSession } from "./clear-session.ts";
import { closePersistDb, disablePersistence, openPersistDb } from "../session-persist.ts";
import { appendEvent } from "../session-repo.ts";
import { readHistorySince } from "../session-history.ts";
import { setup, cmd } from "../../tests/support/server-command-harness.ts";
import type { BufferedEvent } from "../session-host-config.ts";

beforeEach(() => disablePersistence());
afterEach(() => { disablePersistence(); vi.unstubAllEnvs(); });

const fakeEvent = (sessionKey: string): BufferedEvent => ({
  type: "sdk_event",
  sessionKey,
  timestamp: Date.now(),
});

describe("clear_session", () => {
  it("empties the event buffer and resets cost/turns", () => {
    const h = setup({ status: "idle" });
    h.host.eventBuffer = [fakeEvent("leader-1"), fakeEvent("leader-1")];
    h.host.totalCost = 1.23;
    h.host.turns = 5;

    clearSession(h.ctx, cmd({ type: "clear_session" }), h.ws);

    expect(h.host.eventBuffer).toHaveLength(0);
    expect(h.host.totalCost).toBe(0);
    expect(h.host.turns).toBe(0);
  });

  it("emits session_cleared to the bus", () => {
    const h = setup({ status: "idle" });

    clearSession(h.ctx, cmd({ type: "clear_session" }), h.ws);

    const cleared = h.busSent.find((e) => e.type === "session_cleared");
    expect(cleared).toBeDefined();
    expect(cleared!["sessionKey"]).toBe("leader-1");
  });

  it("retains host and durable history and reports a failed clear transaction", () => {
    const h = setup({ status: "idle" });
    const event = fakeEvent("leader-1");
    h.host.eventBuffer = [event];
    h.host.totalCost = 1.23;
    h.host.turns = 5;
    const db = openPersistDb(":memory:");
    appendEvent(db, "leader-1", "sdk_event", event);
    db.exec(`CREATE TRIGGER reject_clear BEFORE INSERT ON event_log
      WHEN NEW.event_type = 'session_cleared' BEGIN SELECT RAISE(ABORT, 'reset failure'); END`);

    clearSession(h.ctx, cmd({ type: "clear_session" }), h.ws);

    expect(h.host.eventBuffer).toEqual([event]);
    expect(h.host.totalCost).toBe(1.23);
    expect(h.host.turns).toBe(5);
    expect(h.busSent).toHaveLength(0);
    expect(h.wsSent).toEqual([expect.objectContaining({
      type: "session_error", sessionKey: "leader-1", code: "SESSION_CLEAR_FAILED",
    })]);
    expect(readHistorySince(db, "leader-1", 0).events).toEqual([expect.objectContaining(event)]);
    expect(db.prepare("SELECT count(*) count FROM sessions").get()).toEqual({ count: 0 });
  });

  it("reports unavailable storage without mutating host state or acknowledging a clear", () => {
    const h = setup({ status: "idle" });
    const event = fakeEvent("leader-1");
    h.host.eventBuffer = [event];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clear-unavailable-"));
    openPersistDb(":memory:"); // Enable real persistence, then force the next open to fail.
    closePersistDb();
    vi.stubEnv("SWARMCREWS_SERVER_DB", dir); // SQLite cannot open a directory as a database.
    try {
      clearSession(h.ctx, cmd({ type: "clear_session" }), h.ws);
      expect(h.host.eventBuffer).toEqual([event]);
      expect(h.busSent).toHaveLength(0);
      expect(h.wsSent[0]).toMatchObject({ type: "session_error", code: "SESSION_CLEAR_FAILED" });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it("acknowledges a successful durable clear and offline recovery resets the old cursor", () => {
    const h = setup({ status: "idle" });
    h.host.eventBuffer = [fakeEvent("leader-1")];
    const db = openPersistDb(":memory:");
    const oldId = appendEvent(db, "leader-1", "sdk_event", h.host.eventBuffer[0]);
    clearSession(h.ctx, cmd({ type: "clear_session" }), h.ws);
    expect(h.wsSent).toHaveLength(0);
    expect(h.busSent.some(e => e.type === "session_cleared")).toBe(true);
    const recovered = readHistorySince(db, "leader-1", oldId);
    expect(recovered.history.reset).toBe(true);
    expect(recovered.events.map(e => e.type)).toEqual(["session_cleared"]);
  });

  it("is a no-op when the session is running", () => {
    const h = setup({ status: "running" });
    h.host.eventBuffer = [fakeEvent("leader-1")];

    clearSession(h.ctx, cmd({ type: "clear_session" }), h.ws);

    expect(h.host.eventBuffer).toHaveLength(1);
    expect(h.busSent).toHaveLength(0);
  });

  it("rejects a work-item-bound host before clearing history", () => {
    const h = setup({ status: "idle" });
    h.host.workItemId = "work-1";
    h.host.eventBuffer = [fakeEvent("leader-1")];
    clearSession(h.ctx, cmd({ type: "clear_session" }), h.ws);
    expect(h.host.eventBuffer).toHaveLength(1);
    expect(h.wsSent[0]).toMatchObject({
      topic: "session:leader-1", type: "session_error", code: "WORK_ITEM_SESSION_PROTECTED",
      workItemId: "work-1",
    });
  });

  it("is a no-op when sessionKey is missing", () => {
    const h = setup({ status: "idle" });
    h.host.eventBuffer = [fakeEvent("leader-1")];

    clearSession(
      h.ctx,
      cmd({ type: "clear_session", sessionKey: undefined }),
      h.ws,
    );

    expect(h.host.eventBuffer).toHaveLength(1);
    expect(h.busSent).toHaveLength(0);
  });

  it("is a no-op for an unknown session key", () => {
    const h = setup({ status: "idle" });

    clearSession(
      h.ctx,
      cmd({ type: "clear_session", sessionKey: "ghost" }),
      h.ws,
    );

    expect(h.busSent).toHaveLength(0);
  });
});
