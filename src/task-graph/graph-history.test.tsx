import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SocketSubscribe } from "../use-socket.ts";
import { createGraphFixture } from "./fixtures.ts";
import { useLeaderTaskGraphController } from "./use-leader-task-graph-controller.ts";
import { LeaderTaskGraphBridge } from "./LeaderTaskGraphBridge.tsx";
import { useTaskGraphHistory } from "./use-task-graph-history.ts";

const old = { ...createGraphFixture(10), graphRunId: "old", title: "Previous investigation", status: "completed" as const };
const current = { ...createGraphFixture(10), graphRunId: "current", title: "Current implementation" };
const runs = [current, old].map(run => ({ graphRunId: run.graphRunId, title: run.title,
  status: run.status, createdAt: run.updatedAt, updatedAt: run.updatedAt }));
function socket() {
  const listeners = new Set<(raw: unknown) => void>();
  const subscribe = Object.assign(((_topic: string, listener: (raw: unknown) => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  }) as unknown as SocketSubscribe, { supportsTopics: true as const });
  const send = vi.fn();
  const emit = (raw: unknown) => act(() => { for (const next of listeners) next(raw); });
  const request = () => send.mock.calls.map(([cmd]) => cmd).filter(cmd => cmd.type === "get_task_graph_history").at(-1);
  const reply = (snapshot: typeof old | typeof current | null, requestId = request().requestId) => emit({
    topic: "work-item:work", type: "task_graph_response", command: "get_task_graph_history",
    requestId, success: true, result: { runs, snapshot },
  });
  const live = (snapshot = current) => emit({ topic: "work-item:work", type: "task_graph_snapshot",
    workItemId: "work", runId: snapshot.graphRunId, revision: snapshot.revision,
    cause: "command_snapshot", timestamp: 1, snapshot });
  return { subscribe, send, emit, request, reply, live };
}

describe("leader graph history", () => {
  it("loads stored runs on mount and inspects history without current plan data or mutation controls", () => {
    const s = socket();
    function Harness() {
      const controller = useLeaderTaskGraphController({ workItemId: "work", socketSend: s.send, socketSubscribe: s.subscribe });
      return <LeaderTaskGraphBridge controller={controller} goal="Latest objective" plan={[
        { taskId: "current-only", title: "Current-only task", status: "running", executor: "minion" },
      ]} />;
    }
    render(<Harness />);
    s.live(); s.reply(null);
    fireEvent.click(screen.getByRole("button", { name: /Graph history:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Previous investigation/ }));
    expect(screen.getByRole("dialog", { name: "Graph history" })).toHaveTextContent("Loading graph history");
    expect(s.request()).toMatchObject({ workItemId: "work", runId: "old" });
    s.reply(old);
    let inspector = screen.getByRole("dialog", { name: "Previous investigation" });
    expect(inspector).toHaveTextContent("Past run · Read only");
    expect(inspector).not.toHaveTextContent("Latest objective");
    expect(inspector).not.toHaveTextContent("Current-only task");
    expect(within(inspector).queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole("button", { name: /Task 7/ }));
    expect(within(inspector).getByRole("button", { name: "Retry" })).toBeDisabled();
    s.live({ ...current, graphRunId: "newest", title: "Newest graph" });
    inspector = screen.getByRole("dialog", { name: "Previous investigation" });
    expect(inspector).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole("button", { name: "Return to current" }));
    const latest = screen.getByRole("dialog", { name: "Newest graph" });
    expect(within(latest).getByRole("button", { name: "Pause" })).toBeEnabled();
    const graphTrigger = within(latest).getByRole("button", { name: /Graph history:/ });
    fireEvent.click(graphTrigger);
    expect(screen.getByRole("menuitemradio", { name: /Previous investigation/ })).toHaveTextContent("completed");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("menuitemradio", { name: /Previous investigation/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Switch graph" })).not.toBeInTheDocument();
    expect(latest).toBeInTheDocument();
    expect(graphTrigger).toHaveFocus();

    fireEvent.click(within(latest).getByRole("button", { name: "Pause" }));
    expect(s.send).toHaveBeenCalledWith(expect.objectContaining({ type: "pause_task_graph_run", runId: "newest" }));
    fireEvent.click(within(latest).getByRole("button", { name: /Graph history:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Previous investigation/ }));
    s.reply(old);
    fireEvent.click(within(screen.getByRole("dialog", { name: old.title })).getByRole("button", { name: "Close graph inspector" }));
    fireEvent.click(screen.getByRole("button", { name: "Open graph" }));
    expect(screen.getByRole("dialog", { name: "Newest graph" })).toBeInTheDocument();
  });

  it("keeps history available when the leader has no current graph", () => {
    const s = socket();
    function Harness() {
      const controller = useLeaderTaskGraphController({ workItemId: "work", socketSend: s.send, socketSubscribe: s.subscribe });
      return <LeaderTaskGraphBridge controller={controller} />;
    }
    render(<Harness />);
    s.reply(null);
    fireEvent.click(screen.getByRole("button", { name: /Graph history:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Previous investigation/ }));
    s.reply(old);
    expect(screen.getByRole("dialog", { name: old.title })).toBeInTheDocument();
  });

  it("ignores late reads after a selection change and keeps historical replies out of the live projection", () => {
    const s = socket();
    const { result } = renderHook(() => useLeaderTaskGraphController({ workItemId: "work", socketSend: s.send, socketSubscribe: s.subscribe }));
    s.live(); s.reply(null);
    act(() => result.current.history.selectRun("old"));
    const oldRequest = s.request().requestId;
    act(() => result.current.history.selectRun("another"));
    s.reply(old, oldRequest);
    expect(result.current.history.snapshot).toBeNull();
    expect(result.current.snapshot?.graphRunId).toBe("current");
    const nextRequest = s.request().requestId;
    act(() => result.current.history.selectRun(null));
    s.reply({ ...old, graphRunId: "another" }, nextRequest);
    expect(result.current.history.selectedRunId).toBeNull();
    expect(result.current.history.snapshot).toBeNull();
    expect(result.current.snapshot?.graphRunId).toBe("current");
  });

  it("retries failures, refetches the selected run on reconnect, and clears history when work items change", () => {
    const s = socket();
    const { result, rerender } = renderHook(({ workItemId }) => useTaskGraphHistory({ workItemId,
      currentRunId: null, send: s.send, subscribe: s.subscribe }), { initialProps: { workItemId: "work" } });
    s.reply(null);
    act(() => result.current.selectRun("old"));
    s.emit({ topic: "work-item:work", type: "task_graph_response", command: "get_task_graph_history",
      requestId: s.request().requestId, success: false, code: "internal", error: "Failed", latest: null });
    expect(result.current.error).toBeTruthy();
    act(() => result.current.refresh());
    s.reply(old);
    expect(result.current.error).toBeNull();
    expect(result.current.snapshot?.graphRunId).toBe("old");
    s.emit({ type: "socket_reconnected" });
    expect(s.request()).toMatchObject({ runId: "old" });
    const previousRequest = s.request().requestId;
    rerender({ workItemId: "other" });
    s.reply(old, previousRequest);
    expect(result.current.runs).toEqual([]);
    expect(result.current.selectedRunId).toBeNull();
    expect(result.current.snapshot).toBeNull();
  });

  it("makes timed-out requests retryable", () => {
    vi.useFakeTimers();
    try {
      const s = socket();
      const { result } = renderHook(() => useTaskGraphHistory({ workItemId: "work", currentRunId: null,
        send: s.send, subscribe: s.subscribe }));
      act(() => vi.advanceTimersByTime(15_000));
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toContain("too long");
      act(() => result.current.refresh());
      s.reply(null);
      expect(result.current.runs).toHaveLength(2);
      expect(result.current.error).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
