import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReviewDiff } from "./use-review-diff.ts";
import type { SocketSubscribe } from "./use-socket.ts";

const snapshot = { id: `sha256:${"a".repeat(64)}`, capturedAt: 1, scope: "workspace", runKey: "s", baseSha: "base", headSha: "head", contributionBinding: "unbound", consistency: "sampled" };
const diff = { filesChanged: 1, insertions: 1, deletions: 0, branch: "main", commits: [], files: [{ file: "actual.ts", status: "added", insertions: 1, deletions: 0, patch: { state: "text", text: "+actual" } }], snapshot };
function setup() {
  const listeners = new Set<(message: unknown) => void>();
  const subscribe = Object.assign(((_topic: string, fn: (message: unknown) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }) as SocketSubscribe, { supportsTopics: true as const });
  const send = vi.fn();
  const hook = renderHook(({ key }) => useReviewDiff(key, send, subscribe), { initialProps: { key: "s" } });
  const latest = () => send.mock.calls.at(-1)![0].requestId;
  const reply = (extra: object) => act(() => { for (const fn of listeners) fn({ type: "control_response", command: "get_worktree_diff", sessionKey: "s", requestId: latest(), ...extra }); });
  return { ...hook, latest, reply };
}
describe("review identity and retained evidence", () => {
  it("rejects malformed or cross-run evidence and retains the last good snapshot", () => {
    const h = setup();
    h.reply({ success: true, diff }); expect(h.result.current.diff).toEqual(diff);
    act(() => h.result.current.refresh());
    h.reply({ success: true, diff: { ...diff, snapshot: { ...snapshot, runKey: "other-run" } } });
    expect(h.result.current.error).toMatch(/identity|run/i);
    expect(h.result.current.diff).toEqual(diff);
    act(() => h.result.current.refresh()); h.reply({ success: true, diff: { files: [] } });
    expect(h.result.current.error).toMatch(/incomplete|invalid/i);
    expect(h.result.current.diff).toEqual(diff);
  });
  it("never leaks prior evidence when the selected session changes", () => {
    const h = setup(); h.reply({ success: true, diff });
    h.rerender({ key: "next" }); expect(h.result.current.diff).toBeNull();
    h.reply({ success: true, diff }); expect(h.result.current.diff).toBeNull();
  });
});

it("retains evidence when reconnect replaces the sender for the same session", () => {
  const listeners = new Set<(message: unknown) => void>();
  const subscribe = Object.assign(((_topic: string, fn: (message: unknown) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }) as SocketSubscribe, { supportsTopics: true as const });
  const send = vi.fn(); const nextSend = vi.fn();
  const h = renderHook(({ sender }) => useReviewDiff("s", sender, subscribe), { initialProps: { sender: send } });
  const requestId = send.mock.calls.at(-1)![0].requestId;
  act(() => { for (const fn of listeners) fn({ type: "control_response", command: "get_worktree_diff", sessionKey: "s", requestId, success: true, diff }); });
  h.rerender({ sender: nextSend });
  expect(h.result.current.diff).toEqual(diff);
  expect(h.result.current.loading).toBe(true);
});
