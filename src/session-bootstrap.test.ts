import { describe, expect, it, vi } from "vitest";
import { BootstrapRequests } from "./session-bootstrap.ts";

describe("in-flight inventory", () => {
  it("does not suppress A → B → A before replies or pin a failed read forever", () => {
    const requests = new BootstrapRequests();
    expect(requests.send({ type: "list_sessions", projectId: "a" })).toBe(true);
    expect(requests.send({ type: "list_sessions", projectId: "b" })).toBe(true);
    expect(requests.send({ type: "list_sessions", projectId: "a" })).toBe(true);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_000);
    expect(requests.send({ type: "list_sessions", projectId: "a" })).toBe(true);
    vi.restoreAllMocks();
  });
  it("coalesces equivalent requests only until a response, and never suppresses switches or retries", () => {
    const requests = new BootstrapRequests();
    expect(requests.send({ type: "list_sessions", projectId: "a" })).toBe(true);
    expect(requests.send({ type: "list_sessions", projectId: "a" })).toBe(false);
    expect(requests.send({ type: "list_sessions", projectId: "b" })).toBe(true);
    requests.received({ type: "session_list", topic: "project:a" });
    expect(requests.send({ type: "list_sessions", projectId: "a" })).toBe(true);
    requests.reset();
    expect(requests.send({ type: "list_sessions", projectId: "b" })).toBe(true);
    expect(requests.send({ type: "list_sessions", projectId: "b", includeArchived: true })).toBe(true);
    expect(requests.send({ type: "sync_session", sessionKey: "x" })).toBe(true);
    expect(requests.send({ type: "sync_session", sessionKey: "x" })).toBe(false);
    expect(requests.send({ type: "sync_session", sessionKey: "x", afterHistoryId: 3 })).toBe(true);
    requests.received({ type: "sync_response", sessionKey: "x", afterHistoryId: 3 });
    expect(requests.send({ type: "sync_session", sessionKey: "x", afterHistoryId: 3 })).toBe(true);
    requests.received({ type: "sync_response", sessionKey: "x" });
    expect(requests.send({ type: "sync_session", sessionKey: "x" })).toBe(true);
  });
});
