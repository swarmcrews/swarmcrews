import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolApprovalPanel } from "./ToolApprovalPanel.tsx";

function fixture() {
  let listener: (msg: unknown) => void = () => {};
  const subscribe = (fn: typeof listener) => { listener = fn; return () => {}; };
  const send = vi.fn();
  const view = render(<ToolApprovalPanel sessionKey="session-a" socketSend={send} socketSubscribe={subscribe} />);
  const request = { id: "approval-a", sessionKey: "session-a", tool: "Bash", details: '{"command":"pwd"}', reason: "Run command?", expiresAt: Date.now() + 300_000 };
  const emit = (msg: object) => act(() => listener({ sessionKey: "session-a", ...msg }));
  const show = () => emit({ type: "tool_approval_snapshot", requests: [request] });
  return { ...view, send, emit, show, request, subscribe };
}
afterEach(() => vi.useRealTimers());
describe("ToolApprovalPanel", () => {
  it("renders actionable details and submits only once until a server snapshot settles it", () => {
    const f = fixture(); f.show();
    expect(screen.getByText('{"command":"pwd"}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(f.send.mock.calls.filter(([msg]) => msg.type === "respond_tool_approval")).toHaveLength(1);
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ sessionKey: "session-a", approvalId: "approval-a", approvalDecision: "allow_once" }));
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
    f.emit({ type: "tool_approval_snapshot", requests: [] });
    expect(screen.queryByRole("region", { name: "Tool approvals" })).toBeNull();
  });
  it("sends denial, reports matching errors and ignores other session messages", () => {
    const f = fixture(); f.show();
    f.emit({ type: "tool_approval_snapshot", sessionKey: "other", requests: [] });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    const decision = f.send.mock.calls.at(-1)![0];
    expect(decision.approvalDecision).toBe("deny");
    f.emit({ type: "control_response", command: "respond_tool_approval", requestId: decision.requestId, success: false, error: "Expired request" });
    expect(screen.getByRole("alert")).toHaveTextContent("Expired request");
    expect(f.send).toHaveBeenLastCalledWith({ type: "get_tool_approvals", sessionKey: "session-a" });
  });
  it("requires a fresh live snapshot on reconnect and never resubmits a decision", () => {
    const f = fixture(); f.show();
    f.emit({ type: "socket_disconnected" });
    expect(screen.getByRole("button", { name: "Allow once" })).toBeDisabled();
    f.emit({ type: "socket_reconnected" });
    expect(screen.getByRole("button", { name: "Allow once" })).toBeDisabled();
    f.emit({ type: "sync_response", found: true, toolApprovals: [f.request] });
    expect(screen.getByRole("button", { name: "Allow once" })).toBeEnabled();
    expect(f.send.mock.calls.every(([msg]) => msg.type === "get_tool_approvals")).toBe(true);
    f.emit({ type: "sync_response", found: true, toolApprovals: [] });
    expect(screen.queryByRole("region", { name: "Tool approvals" })).toBeNull();
  });
  it("rejects foreign request identities even inside a matching session snapshot", () => {
    const f = fixture();
    f.emit({ type: "tool_approval_snapshot", requests: [{ ...f.request, sessionKey: "foreign", tool: "Foreign command" }] });
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
  });
  it("expires locally and ignores historical/unavailable requests", () => {
    vi.useFakeTimers();
    const f = fixture(); f.show();
    act(() => vi.advanceTimersByTime(300_001));
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    f.emit({ type: "sync_response", found: true, toolApprovals: [f.request] });
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
  });
});
