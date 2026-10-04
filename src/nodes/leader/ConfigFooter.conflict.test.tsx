import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigFooter } from "./ConfigFooter.tsx";
import { LEADER_DEFAULT_DATA } from "./types.ts";
import type { ServerMessage, SocketSubscribe } from "../../use-socket.ts";

function boundary() {
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

describe("Canvas legacy conflict review", () => {
  it("blocks all resolution strategies until identified patches recover, and blocks retained evidence during refresh", () => {
    const socket = boundary(); const send = vi.fn(); const update = vi.fn();
    render(<ConfigFooter data={{ ...LEADER_DEFAULT_DATA, sessionKey: "legacy", worktreeIsolation: true,
      worktreeStatus: "active", approvalPending: true, mergeConflict: { conflicts: ["src/example.ts"], summary: "Fixture conflict", targetBranch: "main" } }}
      onUpdateData={update} socketSend={send} socketSubscribe={socket.subscribe} />);
    const strategies = ["Keep Ours", "Keep Main", "Retry"];
    const blocked = () => {
      for (const name of strategies) {
        const control = screen.getByRole("button", { name });
        expect(control).toBeDisabled(); fireEvent.click(control);
      }
      expect(send.mock.calls.filter(([message]) => ["force_merge", "theirs_merge", "retry_merge"].includes(message.type))).toHaveLength(0);
      expect(update).not.toHaveBeenCalled();
    };
    blocked();
    const latest = () => send.mock.calls.filter(([message]) => message.type === "get_worktree_diff").at(-1)![0].requestId;
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latest(), success: false, error: "Read unavailable" });
    blocked();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading changes" }));
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latest(), success: true, diff: evidence });
    fireEvent.click(within(screen.getByRole("region", { name: "Merge conflict review" })).getByText("src/example.ts", { selector: ".review-file__path" }));
    expect(screen.getByText("+after")).toBeVisible();
    for (const name of strategies) expect(screen.getByRole("button", { name })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
    expect(screen.getByText("+after")).toBeVisible(); blocked();
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latest(), success: true, diff: { ...evidence, snapshot: { ...evidence.snapshot, runKey: "other-run" } } });
    blocked();
    expect(screen.getByRole("alert")).toHaveTextContent("identity does not match");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading changes" }));
    socket.deliver({ type: "control_response", command: "get_worktree_diff", sessionKey: "legacy", requestId: latest(), success: true, diff: evidence });
    for (const name of strategies) fireEvent.click(screen.getByRole("button", { name }));
    for (const type of ["force_merge", "theirs_merge", "retry_merge"]) expect(send).toHaveBeenCalledWith({ type, sessionKey: "legacy" });
  });
});
