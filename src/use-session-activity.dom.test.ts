import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ServerMessage, SocketSubscribe } from "./use-socket.ts";
import { useSessionActivity } from "./use-session-activity.ts";

describe("project-scoped activity bootstrap", () => {
  it("retains inventory across callback-only rerenders and unsubscribes project on exit", () => {
    const listeners = new Set<(message: ServerMessage) => void>();
    const subscribe = ((_topic: string, fn: (message: ServerMessage) => void) => {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    }) as SocketSubscribe;
    const firstSend = vi.fn();
    const { result, rerender } = renderHook(({ projectId, send }) => useSessionActivity(subscribe,
      { projectId, connected: true, send }),
      { initialProps: { projectId: "a" as string | null, send: firstSend } });
    act(() => { for (const fn of listeners) fn({ type: "session_list", sessions: [
      { sessionKey: "a-run", sessionId: null, status: "idle", cwd: "/a" },
    ] }); });
    expect(result.current.hasLoaded).toBe(true);
    const nextSend = vi.fn();
    rerender({ projectId: "a", send: nextSend });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.hasLoaded).toBe(true);
    expect(nextSend).not.toHaveBeenCalled();
    rerender({ projectId: null, send: nextSend });
    expect(nextSend).toHaveBeenCalledWith({ type: "list_sessions", projectId: null });
    expect(result.current.sessions).toEqual([]);
  });
});
