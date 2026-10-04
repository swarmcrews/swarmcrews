import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ServerMessage, SocketSubscribe } from "../use-socket.ts";
import { ReviewChangesScreen } from "./ReviewChangesScreen.tsx";

function socketBoundary() {
  const listeners = new Set<(message: ServerMessage) => void>();
  const subscribe = Object.assign(((topicOrFn: string | ((message: ServerMessage) => void), fn?: (message: ServerMessage) => void) => {
    const listener = typeof topicOrFn === "function" ? topicOrFn : fn!;
    listeners.add(listener); return () => { listeners.delete(listener); };
  }) as SocketSubscribe, { supportsTopics: true as const });
  return { subscribe, deliver(message: ServerMessage) { act(() => { for (const listener of listeners) listener(message); }); } };
}
const evidence = {
  branch: "isolated/review", commits: [], filesChanged: 1, insertions: 1, deletions: 1,
  snapshot: { id: `sha256:${"b".repeat(64)}`, capturedAt: 1, baseSha: "base", headSha: "head", scope: "worktree", runKey: "legacy", contributionBinding: "unbound", consistency: "sampled" },
  files: [{ file: "src/example.ts", status: "modified", insertions: 1, deletions: 1, patch: { state: "text", text: "@@ -1 +1 @@\n-before\n+after" } }],
};

describe("mobile legacy conflict review availability", () => {
  it("blocks every merge strategy while loading, failed or refreshing retained evidence, and enables them only after recovery", () => {
    const socket = socketBoundary(); const send = vi.fn();
    render(<ReviewChangesScreen sessionKey="legacy" send={send} subscribe={socket.subscribe} onClose={() => {}} />);
    const latestId = () => send.mock.calls.filter(([message]) => message.type === "get_worktree_diff").at(-1)![0].requestId;
    socket.deliver({ type: "worktree_merge_failed", sessionKey: "legacy", result: { conflicts: ["src/example.ts"], summary: "Conflict retained" } });
    const strategies = ["Retry", "Force", "Theirs"];
    const assertBlocked = () => {
      for (const name of strategies) { const button = screen.getByRole("button", { name }); expect(button).toBeDisabled(); fireEvent.click(button); }
      expect(send.mock.calls.filter(([message]) => ["retry_merge", "force_merge", "theirs_merge"].includes(message.type))).toHaveLength(0);
    };
    assertBlocked();
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latestId(), success: false, error: "Read unavailable" });
    assertBlocked();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading changes" }));
    assertBlocked();
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latestId(), success: true, diff: evidence });
    fireEvent.click(within(screen.getByRole("region", { name: "Changed files" })).getByText("src/example.ts"));
    expect(screen.getByText("+after")).toBeVisible();
    for (const name of strategies) expect(screen.getByRole("button", { name })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
    expect(screen.getByText("+after")).toBeVisible();
    assertBlocked();
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latestId(), success: false, error: "Refresh failed" });
    assertBlocked();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading changes" }));
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latestId(), success: true, diff: evidence });
    for (const name of strategies) fireEvent.click(screen.getByRole("button", { name }));
    expect(send).toHaveBeenCalledWith({ type: "retry_merge", sessionKey: "legacy" });
    expect(send).toHaveBeenCalledWith({ type: "force_merge", sessionKey: "legacy" });
    expect(send).toHaveBeenCalledWith({ type: "theirs_merge", sessionKey: "legacy" });
  });
});
