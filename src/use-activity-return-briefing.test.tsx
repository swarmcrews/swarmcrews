import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { briefingStorageKey, useActivityReturnBriefing } from "./use-activity-return-briefing.ts";
import { captureBriefing } from "./activity-return-briefing.ts";
import type { MobileSessionInfo } from "./mobile/mobile-selectors.ts";

const now = Date.now();
const session = (overrides: Partial<MobileSessionInfo> = {}): MobileSessionInfo => ({
  sessionKey: "s", sessionId: null, cwd: "/repo", status: "running", lastActivityAt: now - 100,
  taskName: "Retry fix", ...overrides,
});
const seed = (project = "p") => localStorage.setItem(briefingStorageKey(project), JSON.stringify(captureBriefing([session()], now - 50)));
const useBriefing = ({ sessions = [session()], project = "p", active = true, ready = true }) =>
  useActivityReturnBriefing(sessions, project, active, ready);

beforeEach(() => localStorage.clear());

describe("Activity visit ownership", () => {
  it("waits for hydrated, visible Activity and does not consume other projects", () => {
    seed();
    const before = localStorage.getItem(briefingStorageKey("p"));
    const { result, rerender } = renderHook(useBriefing, { initialProps: { ready: false, active: true, project: "p" } });
    expect(result.current).toBeNull();
    expect(localStorage.getItem(briefingStorageKey("p"))).toBe(before);
    rerender({ ready: true, active: false, project: "p" });
    expect(result.current).toBeNull();
    rerender({ ready: true, active: true, project: "q" });
    expect(result.current?.firstVisit).toBe(true);
    expect(localStorage.getItem(briefingStorageKey("p"))).toBe(before);
  });

  it("freezes the briefing until refresh, retaining the original visit window", () => {
    seed();
    const { result, rerender } = renderHook(useBriefing, { initialProps: { sessions: [session()] } });
    const since = result.current?.since;
    const saved = localStorage.getItem(briefingStorageKey("p"));
    rerender({ sessions: [session({ status: "completed", lastActivity: "Finished" })] });
    expect(result.current?.entries).toHaveLength(0);
    expect(result.current?.updateCount).toBe(1);
    expect(localStorage.getItem(briefingStorageKey("p"))).toBe(saved);
    act(() => result.current?.refresh());
    expect(result.current?.entries).toHaveLength(1);
    expect(result.current?.updateCount).toBe(0);
    expect(result.current?.since).toBe(since);
  });

  it("does not swallow unseen live outcomes when leaving and returning", () => {
    seed();
    const { result, rerender } = renderHook(useBriefing, { initialProps: { sessions: [session()], active: true } });
    rerender({ sessions: [session({ status: "completed" })], active: false });
    rerender({ sessions: [session({ status: "completed" })], active: true });
    expect(result.current?.entries).toHaveLength(1);
  });

  it("starts a new visit when the browser tab returns, not while it is hidden", () => {
    seed();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      const saved = localStorage.getItem(briefingStorageKey("p"));
      const { result, rerender } = renderHook(useBriefing, { initialProps: { sessions: [session()] } });
      expect(result.current).toBeNull();
      expect(localStorage.getItem(briefingStorageKey("p"))).toBe(saved);
      visibility.mockReturnValue("visible");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(result.current?.entries).toHaveLength(0);
      visibility.mockReturnValue("hidden");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      rerender({ sessions: [session({ status: "completed" })] });
      expect(result.current).toBeNull();
      visibility.mockReturnValue("visible");
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(result.current?.entries).toHaveLength(1);
    } finally { visibility.mockRestore(); }
  });

  it("does not refresh or consume partial reconnect data", () => {
    seed();
    const { result, rerender } = renderHook(useBriefing, { initialProps: { sessions: [session()], ready: true } });
    const saved = localStorage.getItem(briefingStorageKey("p"));
    rerender({ sessions: [session({ status: "completed" })], ready: false });
    act(() => result.current?.refresh());
    expect(result.current?.entries).toHaveLength(0);
    expect(result.current?.updateCount).toBe(0);
    expect(localStorage.getItem(briefingStorageKey("p"))).toBe(saved);
    rerender({ sessions: [session({ status: "completed" })], ready: true });
    expect(result.current?.updateCount).toBe(1);
  });

  it("survives StrictMode effect replay without replacing the prior baseline", () => {
    seed();
    const { result } = renderHook(() => useBriefing({ sessions: [session({ status: "completed" })] }), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    expect(result.current?.entries).toHaveLength(1);
    expect(result.current?.since).toBe(now - 50);
  });

  it("offers a lookback without changing stored visit state", () => {
    const completed = session({ status: "completed", lastActivityAt: now - 2 * 86400000 });
    localStorage.setItem(briefingStorageKey("p"), JSON.stringify(captureBriefing([completed], now - 50)));
    const { result } = renderHook(() => useBriefing({ sessions: [completed] }));
    expect(result.current?.entries).toHaveLength(0);
    const saved = localStorage.getItem(briefingStorageKey("p"));
    act(() => result.current?.setWindow("week"));
    expect(result.current?.entries).toHaveLength(1);
    expect(localStorage.getItem(briefingStorageKey("p"))).toBe(saved);
  });

  it("degrades safely when browser storage is unavailable", () => {
    const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      const { result } = renderHook(() => useBriefing({ sessions: [session({ status: "completed" })] }));
      expect(result.current?.historyAvailable).toBe(false);
      expect(result.current?.entries).toHaveLength(1);
    } finally { read.mockRestore(); write.mockRestore(); }
  });
});
