import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))));
afterEach(() => vi.unstubAllGlobals());
import type { WorkItemRunSnapshot } from "../../shared/work-item-contracts.ts";
import { createGraphFixture } from "../task-graph/fixtures.ts";
import type { RunTaskContext } from "../work-item-run-context.ts";
import { ActivityTranscript } from "../WorkItemTranscript.tsx";
import { useWorkItemHistory } from "../use-work-item-history.ts";
import type { SocketSubscribe } from "../use-socket.ts";

function run(n: number): WorkItemRunSnapshot {
  return { runKey: `run-${n}`, workItemId: "work", runKind: "primary", parentRunKey: null,
    taskId: null, runNumber: n, previousRunKey: null, providerSessionId: null,
    outcome: "completed", startedAt: n, endedAt: n + 1, finalReport: `Summary ${n}` };
}
const child: WorkItemRunSnapshot = { ...run(9), runKey: "child", runKind: "child",
  runNumber: null, parentRunKey: "run-8", taskId: "task" };
function harness(context: RunTaskContext = {}) {
  const listeners = new Set<(message: unknown) => void>();
  const subscribe = Object.assign(((_topic: string, fn: (message: unknown) => void) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }) as SocketSubscribe, { supportsTopics: true as const });
  const send = vi.fn();
  const loadRuns = vi.fn();
  function emit(message: unknown) { act(() => listeners.forEach((fn) => fn(message))); }
  function replay(sessionKey: string, text: string) {
    emit({ type: "sync_response", sessionKey, found: true, status: "completed", events: [
      { type: "sdk_event", sessionKey, timestamp: 10, event: { kind: "text", role: "assistant", text } },
    ] });
  }
  function View({ runs, cursor = null, currentRunKey = "run-8" }: {
    runs: WorkItemRunSnapshot[]; cursor?: string | null; currentRunKey?: string;
  }) {
    const history = useWorkItemHistory({ workItemId: "work", runs, runNextCursor: cursor,
      currentRunKey, socketSend: send, socketSubscribe: subscribe, onLoadRuns: loadRuns });
    return <ActivityTranscript unified history={history} currentRunKey={currentRunKey}
      currentMessages={[{ id: "live", role: "assistant", content: "Live conversation", timestamp: 9 }]}
      currentStreamingText="Live streaming" taskPlan={[{ taskId: "task", title: "Check regression" }]} {...context} />;
  }
  return { View, send, loadRuns, replay, emit };
}
const runs = Array.from({ length: 8 }, (_, i) => run(i + 1));

describe("progressive work-item transcript", () => {
  it("loads historical iteration content on demand from durable history, one page at a time", async () => {
    const page = (id: number, text: string, before: number | null) => ({
      events: [{ type: "sdk_event", sessionKey: "run-1", historyId: id, timestamp: id,
        event: { kind: "text", role: "assistant", text } }],
      history: { before, highWater: 20, url: "/api/history/run-1" },
    });
    const fetchHistory = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page(20, "Saved latest answer", 20))))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(10, "Saved earlier answer", null))));
    vi.stubGlobal("fetch", fetchHistory);
    const h = harness();
    render(<h.View runs={[run(1), run(2)]} currentRunKey="run-2" />);
    h.emit({ type: "sync_response", sessionKey: "run-1", found: false });
    expect(fetchHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show transcript: Iteration 1 · completed" }));
    expect(await screen.findByText("Saved latest answer")).toBeInTheDocument();
    expect(fetchHistory).toHaveBeenCalledTimes(1);
    expect(fetchHistory).toHaveBeenLastCalledWith("/api/history/run-1?format=json", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(await screen.findByText("Saved earlier answer")).toBeInTheDocument();
    expect(fetchHistory).toHaveBeenLastCalledWith("/api/history/run-1?format=json&before=20", expect.anything());
    expect(screen.getByText("Saved latest answer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();
    expect(screen.getByText("Live conversation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide transcript: Iteration 1 · completed" }));
    expect(screen.queryByText("Saved latest answer")).not.toBeInTheDocument();
  });

  it("loads durable child history when the session host is no longer available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      events: [{ type: "sdk_event", sessionKey: "child", historyId: 1, timestamp: 10,
        event: { kind: "text", role: "assistant", text: "Archived child output" } }],
      history: { before: null },
    }))));
    const h = harness();
    render(<h.View runs={[...runs, child]} />);
    fireEvent.click(screen.getByRole("button", { name: /Show child transcript/ }));
    h.emit({ type: "sync_response", sessionKey: "child", found: false });
    expect(await screen.findByText("Archived child output")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/history/child?format=json", expect.anything());
  });

  it("shows inline node context without loading the child transcript", () => {
    const node = createGraphFixture(1).nodes[0]!;
    const h = harness({ graphNodes: [{ ...node, id: "task", title: "Check regression",
      objective: "Check the session history regression coverage",
      currentAttempt: { ...node.currentAttempt!, id: "matching-attempt", harness: "pi", model: "test-model" },
    }] });
    render(<h.View runs={[...runs, { ...child, attemptId: "matching-attempt", attemptNumber: 2 }]} />);
    const toggle = screen.getByRole("button", { name: /Show child transcript/ });
    expect(within(toggle).getByText("Attempt 2 · pi · test-model")).toBeInTheDocument();
    expect(within(toggle).getByText("Check the session history regression coverage")).toBeInTheDocument();
    expect(h.send).not.toHaveBeenCalledWith({ type: "sync_session", sessionKey: "child" });
  });

  it("keeps node context and inspection available for children of older iterations", () => {
    const node = createGraphFixture(1).nodes[0]!;
    const inspect = vi.fn();
    const h = harness({ graphNodes: [{ ...node, id: "task", title: "Historical task",
      objective: "Review historical session output" }], onInspectNode: inspect });
    render(<h.View runs={[...runs, { ...child, parentRunKey: "run-5", attemptNumber: 1 }]} />);
    fireEvent.click(screen.getByRole("button", { name: /Browse older iterations/ }));
    fireEvent.click(screen.getByRole("button", { name: /Iteration 5 · completed/ }));
    const toggle = screen.getByRole("button", { name: /Show child transcript: Child run · Historical task/ });
    expect(within(toggle).getByText("Review historical session output")).toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription("Attempt 1 — Review historical session output");
    fireEvent.click(screen.getByRole("button", { name: "Inspect Child run · Historical task" }));
    expect(inspect).toHaveBeenCalledWith("task");
    expect(h.send).not.toHaveBeenCalledWith({ type: "sync_session", sessionKey: "child" });
  });

  it("keeps child output out of the feed and off the wire until explicitly expanded", () => {
    const h = harness();
    render(<h.View runs={[...runs, child]} />);
    expect(h.send.mock.calls.map(([msg]) => msg.sessionKey)).toEqual(["run-8"]);
    expect(screen.getByText("Live conversation")).toBeInTheDocument();
    expect(screen.getByText("Live streaming")).toBeInTheDocument();
    expect(screen.getByText("Child run · Check regression · completed")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /Show child transcript/ }))
      .getByText("Child run · Check regression · completed")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Earlier iterations" })).not.toBeInTheDocument();
    h.replay("child", "Hidden output");
    expect(screen.queryByText("Hidden output")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show child transcript/ }));
    expect(h.send).toHaveBeenLastCalledWith({ type: "sync_session", sessionKey: "child" });
    expect(screen.getByText("Loading run transcript…")).toBeInTheDocument();
    h.replay("child", "Visible output");
    expect(screen.getByText("Visible output")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hide child transcript/ }));
    expect(screen.queryByText("Visible output")).not.toBeInTheDocument();
    h.send.mockClear();
    h.emit({ type: "socket_reconnected" });
    expect(h.send.mock.calls.map(([msg]) => msg.sessionKey)).toEqual(["run-8"]);
  });

  it("offers skimmable older summaries and retrieves only the selected iteration", async () => {
    const fetchHistory = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [
        { type: "sdk_event", sessionKey: "run-5", historyId: 1, timestamp: 10,
          event: { kind: "text", role: "assistant", text: "Earlier answer" } },
      ], history: { before: null } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [], history: { before: null } })));
    vi.stubGlobal("fetch", fetchHistory);
    const h = harness();
    render(<h.View runs={runs} />);
    expect(screen.queryByText("Summary 5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Browse older iterations/ }));
    expect(screen.getByText("Summary 5")).toBeInTheDocument();
    expect(fetchHistory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Iteration 5 · completed/ }));
    expect(await within(screen.getByRole("region", { name: "Iteration 5 preview" })).findByText("Earlier answer")).toBeInTheDocument();
    expect(fetchHistory).toHaveBeenLastCalledWith("/api/history/run-5?format=json", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Older iteration" }));
    expect(fetchHistory).toHaveBeenLastCalledWith("/api/history/run-4?format=json", expect.anything());
    expect(screen.queryByText("Earlier answer")).not.toBeInTheDocument();
    expect(await screen.findByText("No saved messages for this iteration.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hide older iterations/ }));
    expect(screen.queryByText("No saved messages for this iteration.")).not.toBeInTheDocument();
    expect(screen.getByText("Live conversation")).toBeInTheDocument();
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("does not drain metadata pages and loads another page as the reader scrolls", () => {
    const h = harness();
    const entries = Array.from({ length: 13 }, (_, i) => run(i + 1));
    const { rerender } = render(<h.View runs={entries} currentRunKey="run-13" cursor="page-2" />);
    expect(h.loadRuns).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Browse older iterations/ }));
    const index = screen.getByLabelText("Older iterations");
    Object.defineProperties(index, { scrollHeight: { value: 600 }, clientHeight: { value: 300 } });
    fireEvent.scroll(index, { target: { scrollTop: 290 } });
    expect(h.loadRuns).toHaveBeenCalledExactlyOnceWith("page-2");
    fireEvent.scroll(index, { target: { scrollTop: 300 } });
    expect(h.loadRuns).toHaveBeenCalledTimes(1);
    rerender(<h.View runs={[run(0), ...entries]} currentRunKey="run-13" cursor={null} />);
    expect(screen.getByText("Summary 0")).toBeInTheDocument();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Load older iterations" })).not.toBeInTheDocument();
  });

  it("bounds the summary list and supports a keyboard-accessible load-more fallback", () => {
    const h = harness();
    const entries = Array.from({ length: 30 }, (_, i) => run(i + 1));
    render(<h.View runs={entries} currentRunKey="run-30" />);
    fireEvent.click(screen.getByRole("button", { name: /Browse older iterations/ }));
    const index = screen.getByLabelText("Older iterations");
    expect(within(index).getAllByRole("button")).toHaveLength(11);
    expect(screen.queryByText("Summary 1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load older iterations" }));
    expect(within(index).getAllByRole("button")).toHaveLength(21);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});
