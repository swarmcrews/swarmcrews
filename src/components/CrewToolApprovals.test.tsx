import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolApprovalRequest } from "../../shared/tool-approval.ts";
import { createReplaySocket } from "../../tests/harness/ws-replay.ts";
import type { ServerMessage } from "../use-socket.ts";
import { CrewToolApprovals } from "./CrewToolApprovals.tsx";

const members = [{ sessionKey: "child-a", title: "Patch source" }, { sessionKey: "child-b", title: "Run tests" }];
function fixture() {
  const { socket, replay } = createReplaySocket();
  const props = { sessionKey: "leader", members, socketSend: socket.send, socketSubscribe: socket.subscribe };
  const view = render(<CrewToolApprovals {...props} />);
  const emit = async (message: ServerMessage) => { await act(async () => replay([{ message }])); };
  const request = (sessionKey: string): ToolApprovalRequest => ({ id: "same-provider-id", sessionKey, tool: "Bash",
    reason: "Confirm this invocation", details: `pwd for ${sessionKey}`, expiresAt: Date.now() + 60_000 });
  const snapshot = (sessionKey: string) => emit({ type: "tool_approval_snapshot", sessionKey, requests: [request(sessionKey)] });
  const panel = (name: string) => within(screen.getByRole("region", { name: `Tool approvals for ${name}` }));
  const decisions = () => socket.sent.filter(message => (message as { type: string }).type === "respond_tool_approval");
  return { ...view, props, socket, emit, request, snapshot, panel, decisions };
}
afterEach(() => vi.useRealTimers());

describe("CrewToolApprovals", () => {
  it("deduplicates the explicit roster and never subscribes to uncreated or synthetic sessions", () => {
    const f = fixture();
    expect(f.socket.sent).toEqual([... ["leader", "child-a", "child-b"].map(sessionKey => ({ type: "get_tool_approvals", sessionKey })), { type: "sync_session", sessionKey: "leader" }]);
    f.rerender(<CrewToolApprovals {...f.props} members={[...members, ...members, { sessionKey: "leader", title: "Duplicate" },
      { sessionKey: null, title: "Starting" }, { sessionKey: "work-item:draft", title: "Draft" }]} />);
    expect(f.socket.sent).toHaveLength(4);
    expect(f.socket.subscriberCount).toBe(8); // each live panel plus the parent membership subscription
  });

  it("keeps identical approval IDs independent across children and decisions invocation-only", async () => {
    const f = fixture();
    await f.snapshot("child-a"); await f.snapshot("child-b"); await f.snapshot("foreign");
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(f.panel("Patch source").getByText("child-a")).toBeVisible();
    fireEvent.click(f.panel("Patch source").getByRole("button", { name: "Allow once" }));
    expect(f.panel("Patch source").getByRole("button", { name: "Deny" })).toBeDisabled();
    expect(f.panel("Run tests").getByRole("button", { name: "Deny" })).toBeEnabled();
    fireEvent.click(f.panel("Run tests").getByRole("button", { name: "Deny" }));
    expect(f.decisions()).toEqual([
      { type: "respond_tool_approval", sessionKey: "child-a", approvalId: "same-provider-id", approvalDecision: "allow_once", requestId: expect.any(String) },
      { type: "respond_tool_approval", sessionKey: "child-b", approvalId: "same-provider-id", approvalDecision: "deny", requestId: expect.any(String) },
    ]);
    // A roster reorder/rename must not re-enable a request awaiting confirmation.
    f.rerender(<CrewToolApprovals {...f.props} members={[members[1]!, { ...members[0]!, title: "Renamed patch" }]} />);
    expect(f.panel("Renamed patch").getByRole("button", { name: "Allow once" })).toBeDisabled();
    expect(f.decisions()).toHaveLength(2);
  });

  it("refreshes each child on reconnect, requires that child's snapshot, and expires without replay", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.snapshot("child-a"); await f.snapshot("child-b");
    fireEvent.click(f.panel("Patch source").getByRole("button", { name: "Allow once" }));
    await f.emit({ type: "socket_disconnected" });
    expect(f.panel("Run tests").getByRole("button", { name: "Deny" })).toBeDisabled();
    const before = f.socket.sent.length;
    await f.emit({ type: "socket_reconnected" });
    expect(f.socket.sent.slice(before)).toEqual([... ["leader", "child-a", "child-b"].map(sessionKey => ({ type: "get_tool_approvals", sessionKey })), { type: "sync_session", sessionKey: "leader" }]);
    expect(f.panel("Run tests").getByRole("button", { name: "Deny" })).toBeDisabled();
    await f.emit({ type: "sync_response", sessionKey: "child-b", found: true, toolApprovals: [f.request("child-b"), f.request("foreign")] });
    expect(f.panel("Run tests").getByRole("button", { name: "Deny" })).toBeEnabled();
    expect(f.panel("Patch source").getByRole("button", { name: "Allow once" })).toBeDisabled();
    expect(screen.queryByText("pwd for foreign")).toBeNull();
    await f.emit({ type: "sync_response", sessionKey: "child-a", found: false });
    expect(screen.queryByRole("region", { name: "Tool approvals for Patch source" })).toBeNull();
    act(() => vi.advanceTimersByTime(60_001));
    expect(screen.queryByRole("region")).toBeNull();
    expect(f.decisions()).toHaveLength(1);
  });

  it("drops removed children and stale panels when switching crews", async () => {
    const f = fixture();
    await f.snapshot("child-a");
    f.rerender(<CrewToolApprovals {...f.props} sessionKey="new-leader" members={[{ sessionKey: "new-child", title: "New task" }]} />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(f.socket.subscriberCount).toBe(6);
    await f.snapshot("child-a");
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    const before = f.socket.sent.length;
    await f.emit({ type: "socket_reconnected" });
    expect(f.socket.sent.slice(before)).toEqual([... ["new-leader", "new-child"].map(sessionKey => ({ type: "get_tool_approvals", sessionKey })), { type: "sync_session", sessionKey: "new-leader" }]);
    f.unmount();
    expect(f.socket.subscriberCount).toBe(0);
  });
});
