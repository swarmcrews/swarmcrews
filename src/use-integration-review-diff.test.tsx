import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIntegrationReviewDiff } from "./use-integration-review-diff.ts";
import { reviewSocket } from "../tests/support/canonical-review-fixture.ts";
const diff = { branch: "combined", filesChanged: 1, insertions: 1, deletions: 0, commits: [],
  files: [{ file: "combined.ts", status: "added", insertions: 1, deletions: 0, patch: { state: "text", text: "+combined" } }],
  snapshot: { id: `sha256:${"a".repeat(64)}`, capturedAt: 1, baseSha: "b".repeat(40), headSha: "c".repeat(40),
    scope: "worktree", consistency: "immutable", contributionBinding: "lineage", lineageId: "l", lineageRevision: 4 } };
function setup() {
  const socket = reviewSocket(), send = vi.fn();
  const h = renderHook(({ id, revision }) => useIntegrationReviewDiff(id, undefined, String(revision), send, socket.subscribe),
    { initialProps: { id: "l", revision: 4 } });
  const reply = (extra: object, request = send.mock.calls.at(-1)![0]) => act(() => socket.receive({
    type: "integration_review_diff_response", lineageId: request.lineageId, contributionId: null, requestId: request.requestId, ...extra,
  }));
  return { ...h, send, reply };
}
describe("durable review query correlation and recovery", () => {
  it("retains previous evidence on errors/mismatched identity, but never across selected lineage IDs", () => {
    const h = setup(); h.reply({ success: true, diff });
    expect(h.result.current.diff).toEqual(diff);
    act(() => h.result.current.refresh());
    h.reply({ success: true, diff: { ...diff, snapshot: { ...diff.snapshot, lineageId: "other" } } });
    expect(h.result.current.error).toMatch(/identity/i); expect(h.result.current.diff).toEqual(diff);
    h.rerender({ id: "l", revision: 5 }); expect(h.result.current.loading).toBe(true);
    h.reply({ success: false, error: "capture raced" }); expect(h.result.current.diff).toEqual(diff);
    expect(h.result.current.error).toBe("capture raced");
    h.rerender({ id: "other", revision: 5 }); expect(h.result.current.diff).toBeNull();
  });
  it("ignores replaced requests, malformed evidence and unsolicited/cross-target replies", () => {
    const h = setup(); const old = h.send.mock.calls.at(-1)![0];
    act(() => h.result.current.refresh());
    h.reply({ success: true, diff }, old); expect(h.result.current.loading).toBe(true);
    h.reply({ success: true, diff, contributionId: "unrelated" }); expect(h.result.current.loading).toBe(true);
    h.reply({ success: true, diff: {} }); expect(h.result.current.error).toMatch(/invalid/i);
    expect(h.result.current.diff).toBeNull();
    expect(h.send.mock.calls.every(([q]) => q.type === "get_integration_review_diff" && q.lineageId === "l" && !q.runKey && !q.sessionKey)).toBe(true);
  });
  it("times out without discarding the last evidence and offers retry", () => {
    vi.useFakeTimers();
    try {
      const h = setup(); h.reply({ success: true, diff });
      act(() => h.result.current.refresh()); act(() => vi.advanceTimersByTime(15_001));
      expect(h.result.current.error).toMatch(/Retry/i); expect(h.result.current.diff).toEqual(diff);
      act(() => h.result.current.refresh()); h.reply({ success: true, diff });
      expect(h.result.current.error).toBeNull(); h.unmount();
    } finally { vi.useRealTimers(); }
  });
});
