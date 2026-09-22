import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkItemRunSnapshot } from "../shared/work-item-contracts.ts";
import { buildUnifiedWorkItemMessages } from "./WorkItemTranscript.tsx";
import { emptySessionStreamState } from "./session-stream.ts";
import { useWorkItemHistory } from "./use-work-item-history.ts";
import type { SocketSubscribe } from "./use-socket.ts";
import { previousPrimaryRuns } from "./work-item-run-history.ts";

function run(runKey: string, startedAt: number, runNumber: number): WorkItemRunSnapshot {
  return {
    runKey, workItemId: "work-1", runKind: "primary", parentRunKey: null,
    taskId: null, runNumber, previousRunKey: runNumber > 1 ? `run-${runNumber - 1}` : null,
    providerSessionId: null, outcome: runNumber === 2 ? "none" : "completed",
    startedAt, endedAt: runNumber === 2 ? null : startedAt + 1,
    finalReport: runNumber === 2 ? null : "First complete",
  };
}

function socketHarness() {
  const listeners = new Set<(message: unknown) => void>();
  const subscribe = Object.assign(
    ((_topic: string, listener: (message: unknown) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }) as SocketSubscribe,
    { supportsTopics: true as const },
  );
  return {
    subscribe,
    emit(message: unknown) {
      act(() => listeners.forEach((listener) => listener(message)));
    },
  };
}

describe("useWorkItemHistory", () => {
  it("does not replay children or iterations older than the latest three", () => {
    const socket = socketHarness();
    const send = vi.fn();
    const loadRuns = vi.fn();
    const runs = [1, 2, 3, 4, 5].map((n) => run(`run-${n}`, n * 10, n));
    runs.push({ ...run("child", 55, 0), runKind: "child", parentRunKey: "run-5" });
    renderHook(() => useWorkItemHistory({
      workItemId: "work-1", runs, runNextCursor: "older-page",
      onLoadRuns: loadRuns, socketSend: send, socketSubscribe: socket.subscribe,
    }));
    expect(send.mock.calls.map(([command]) => command.sessionKey)).toEqual(["run-3", "run-4", "run-5"]);
    expect(loadRuns).not.toHaveBeenCalled();
    socket.emit({ type: "sdk_event", sessionKey: "child", timestamp: 56,
      event: { kind: "text", role: "assistant", text: "Hidden child" } });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("releases closed transcripts, shares open requests, and reconnects only visible runs", () => {
    const socket = socketHarness();
    const send = vi.fn();
    const runs = [1, 2, 3, 4, 5].map((n) => run(`run-${n}`, n * 10, n));
    const { result } = renderHook(() => useWorkItemHistory({
      workItemId: "work-1", runs, runNextCursor: null, socketSend: send, socketSubscribe: socket.subscribe,
    }));
    act(() => { result.current.loadRun("run-1"); result.current.loadRun("run-1"); });
    expect(send).toHaveBeenCalledTimes(4);
    socket.emit({ type: "sync_response", sessionKey: "run-1", found: true, events: [
      { type: "sdk_event", sessionKey: "run-1", timestamp: 11,
        event: { kind: "text", role: "assistant", text: "Old answer" } },
    ] });
    expect(result.current.streams["run-1"]?.messages).toHaveLength(1);
    act(() => result.current.releaseRun("run-1"));
    expect(result.current.streams["run-1"]?.messages).toHaveLength(1);
    act(() => result.current.releaseRun("run-1"));
    expect(result.current.streams["run-1"]).toBeUndefined();
    send.mockClear();
    socket.emit({ type: "socket_reconnected" });
    expect(send.mock.calls.map(([command]) => command.sessionKey)).toEqual(["run-3", "run-4", "run-5"]);
    socket.emit({ type: "sync_response", sessionKey: "run-1", found: true, events: [] });
    expect(result.current.streams["run-1"]).toBeUndefined();
  });

  it("reserves a recent slot for a current run missing from the ledger", () => {
    const send = vi.fn();
    const socket = socketHarness();
    const { result } = renderHook(() => useWorkItemHistory({
      workItemId: "work-1", runs: [1, 2, 3].map((n) => run(`run-${n}`, n * 10, n)),
      currentRunKey: "run-4", runNextCursor: null, socketSend: send, socketSubscribe: socket.subscribe,
    }));
    expect(send.mock.calls.map(([command]) => command.sessionKey)).toEqual(["run-2", "run-3"]);
    expect(result.current.olderRuns.map((entry) => entry.runKey)).toEqual(["run-1"]);
  });

  it("discards opened runs and late responses when switching work items", () => {
    const send = vi.fn();
    const socket = socketHarness();
    const { result, rerender } = renderHook(({ workItemId, runs }) => useWorkItemHistory({
      workItemId, runs, runNextCursor: null, socketSend: send, socketSubscribe: socket.subscribe,
    }), { initialProps: { workItemId: "work-1", runs: [run("run-1", 10, 1)] } });
    act(() => result.current.loadRun("child"));
    send.mockClear();
    rerender({ workItemId: "work-2", runs: [] });
    socket.emit({ type: "sync_response", sessionKey: "child", found: true, events: [] });
    expect(result.current.streams).toEqual({});
    expect(send).not.toHaveBeenCalled();
    rerender({ workItemId: "work-1", runs: [run("run-1", 10, 1)] });
    expect(send).not.toHaveBeenCalledWith({ type: "sync_session", sessionKey: "child" });
  });

  it("retains the displayed run before replay and clears it when changing work items", () => {
    const first = emptySessionStreamState("run-1");
    first.messages = [{ id: "restored", role: "assistant", content: "Visible before replay", timestamp: 11 }];
    first.historyHighWater = 10;
    const { result, rerender } = renderHook(
      ({ workItemId, currentStream }) => useWorkItemHistory({
        workItemId, runs: [], runNextCursor: undefined, currentStream,
      }),
      { initialProps: { workItemId: "work-1", currentStream: first } },
    );
    rerender({ workItemId: "work-1", currentStream: emptySessionStreamState("run-2") });
    expect(result.current.streams["run-1"]).toMatchObject({
      messages: first.messages, historyHighWater: 10,
    });
    rerender({ workItemId: "work-2", currentStream: emptySessionStreamState("other-run") });
    expect(result.current.streams).toEqual({});
  });

  it("loads metadata until three recent iterations are available", () => {
    const socket = socketHarness();
    const send = vi.fn();
    const loadRuns = vi.fn();
    const runs = [run("run-2", 20, 2), run("run-1", 10, 1)];
    const { result, rerender } = renderHook(
      ({ cursor }) => useWorkItemHistory({
        workItemId: "work-1", runs, runNextCursor: cursor,
        onLoadRuns: loadRuns, socketSend: send, socketSubscribe: socket.subscribe,
      }),
      { initialProps: { cursor: "page-2" as string | null } },
    );

    expect(loadRuns).toHaveBeenCalledWith("page-2");
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      { type: "sync_session", sessionKey: "run-1" },
      { type: "sync_session", sessionKey: "run-2" },
    ]);

    socket.emit({
      type: "sync_response", sessionKey: "run-1", found: true, status: "completed",
      events: [{
        type: "sdk_event", sessionKey: "run-1", timestamp: 11,
        event: { kind: "text", role: "assistant", text: "First iteration output" },
      }],
    });
    expect(result.current.streams["run-1"]?.messages[0]?.content)
      .toBe("First iteration output");

    rerender({ cursor: null });
    expect(result.current.orderedRuns.map((entry) => entry.runKey)).toEqual(["run-1", "run-2"]);
  });

  it("requests the first ledger page for a selected work item", () => {
    const loadRuns = vi.fn();
    renderHook(() => useWorkItemHistory({
      workItemId: "work-1", runs: [], runNextCursor: undefined, onLoadRuns: loadRuns,
    }));
    expect(loadRuns).toHaveBeenCalledWith(undefined);
  });

  it("requests the first ledger page when a live current run arrived before history", () => {
    const loadRuns = vi.fn();
    renderHook(() => useWorkItemHistory({
      workItemId: "work-1", runs: [run("run-2", 20, 2)], runNextCursor: undefined,
      onLoadRuns: loadRuns,
    }));

    expect(loadRuns).toHaveBeenCalledWith(undefined);
  });

  it("re-syncs known runs after a socket reconnect", () => {
    const first = socketHarness();
    const second = socketHarness();
    const send = vi.fn();
    const runs = [run("run-1", 10, 1)];
    const { rerender } = renderHook(
      ({ subscribe }) => useWorkItemHistory({
        workItemId: "work-1", runs, runNextCursor: null,
        socketSend: send, socketSubscribe: subscribe,
      }),
      { initialProps: { subscribe: first.subscribe } },
    );
    expect(send).toHaveBeenCalledTimes(1);
    rerender({ subscribe: second.subscribe });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, "page-2"])(
    "recovers history through the stable socket subscription with cursor %s",
    (cursor) => {
      const socket = socketHarness();
      const send = vi.fn();
      const loadRuns = vi.fn();
      const runs = [run("run-2", 20, 2)];
      const { result, rerender } = renderHook(
        ({ entries, nextCursor }) => useWorkItemHistory({
          workItemId: "work-1", runs: entries, runNextCursor: nextCursor,
          onLoadRuns: loadRuns, socketSend: send, socketSubscribe: socket.subscribe,
        }),
        { initialProps: { entries: runs, nextCursor: cursor as string | null | undefined } },
      );
      loadRuns.mockClear();
      send.mockClear();

      socket.emit({ type: "socket_reconnected" });

      expect(loadRuns).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(send).toHaveBeenCalledExactlyOnceWith({ type: "sync_session", sessionKey: "run-2" });
      rerender({ entries: [run("run-1", 10, 1), ...runs], nextCursor: null });
      expect(send).toHaveBeenLastCalledWith({ type: "sync_session", sessionKey: "run-1" });
      socket.emit({
        type: "sync_response", sessionKey: "run-1", found: true,
        events: [{ type: "sdk_event", sessionKey: "run-1", timestamp: 11,
          event: { kind: "text", role: "assistant", text: "Recovered earlier iteration" } }],
      });
      expect(result.current.streams["run-1"]?.messages[0]?.content)
        .toBe("Recovered earlier iteration");
    },
  );
});

describe("buildUnifiedWorkItemMessages", () => {
  it.each([false, true])("keeps one initial prompt before launch confirmation (replayed=%s)", (replayed) => {
    const first = emptySessionStreamState("run-1");
    const prompt = { id: "local", role: "user" as const, content: "Start work", timestamp: 1, optimistic: true };
    first.messages = replayed ? [
      { ...prompt, id: "persisted", optimistic: false },
      { id: "reply", role: "assistant", content: "Starting work", timestamp: 2 },
    ] : [];
    const messages = buildUnifiedWorkItemMessages({
      runs: [{ ...run("run-1", 1, 1), outcome: "none" }], streams: { "run-1": first },
      currentRunKey: "", currentMessages: [prompt],
    });
    expect(messages.map((message) => message.content)).toEqual([
      "Iteration 1 · Active now", "Start work", ...(replayed ? ["Starting work"] : []),
    ]);
    expect(messages[1]?.id).toBe(replayed ? "persisted" : "local");
  });

  it("preserves an identical submission belonging to a later run", () => {
    const first = emptySessionStreamState("run-1");
    first.messages = [{ id: "persisted", role: "user", content: "Continue", timestamp: 1 }];
    const messages = buildUnifiedWorkItemMessages({
      runs: [run("run-1", 1, 1)], streams: { "run-1": first }, currentRunKey: "run-2",
      currentMessages: [{ id: "local", role: "user", content: "Continue", timestamp: 2, optimistic: true }],
    });
    expect(messages.map((message) => message.content)).toEqual([
      "Iteration 1 · completed", "Continue", "Continue",
    ]);
  });

  it.each([
    { taskPlan: [{ taskId: "node-opaque-guid", title: "Audit session recovery" }], label: "Child run · Audit session recovery" },
    { taskPlan: [], label: "Child run" },
  ])("uses a readable fallback without linking an unavailable node: $label", ({ taskPlan, label }) => {
    const messages = buildUnifiedWorkItemMessages({
      runs: [{ ...run("child", 10, 1), runKind: "child", runNumber: null,
        parentRunKey: "run-1", taskId: "node-opaque-guid", attemptId: "attempt-1", attemptNumber: 1 }],
      streams: {}, currentRunKey: "run-2", currentMessages: [],
      graphNodes: [{ id: "unrelated-node", title: "Another task" }],
      taskPlan, onInspectNode: vi.fn(),
    });
    expect(messages[0]).toMatchObject({ label, content: `${label} · completed` });
    expect(messages[0]).not.toHaveProperty("onInspect");
  });

  it("keeps the current conversation visible before its ledger entry arrives", () => {
    const first = emptySessionStreamState("run-1");
    first.messages = [{ id: "old", role: "assistant", content: "Earlier work", timestamp: 11 }];
    const messages = buildUnifiedWorkItemMessages({
      runs: [run("run-1", 10, 1)], streams: { "run-1": first }, currentRunKey: "run-2",
      currentMessages: [{ id: "current", role: "assistant", content: "Current work", timestamp: 21 }],
    });
    expect(messages.map((message) => message.content)).toEqual([
      "Iteration 1 · completed", "Earlier work", "Current work",
    ]);
  });

  it("adds ordered iteration boundaries and preserves the live current transcript", () => {
    const first = emptySessionStreamState("run-1");
    first.messages = [{ id: "old", role: "assistant", content: "Earlier work", timestamp: 11 }];
    const messages = buildUnifiedWorkItemMessages({
      runs: [run("run-1", 10, 1), run("run-2", 20, 2)],
      streams: { "run-1": first },
      currentRunKey: "run-2",
      currentMessages: [{ id: "current", role: "assistant", content: "Current work", timestamp: 21 }],
    });
    expect(messages.map((message) => message.content)).toEqual([
      "Iteration 1 · completed", "Earlier work", "Iteration 2 · Active now", "Current work",
    ]);
    expect(messages[0]).toMatchObject({ kind: "run-boundary", label: "Iteration 1" });
    expect(messages[0]).not.toHaveProperty("role");
  });

  it("selects every previous primary iteration newest-first without child runs", () => {
    const child: WorkItemRunSnapshot = {
      ...run("child-1", 15, 1),
      runKind: "child",
      parentRunKey: "run-1",
      taskId: "delegated-task",
      runNumber: null,
      previousRunKey: null,
    };
    const selected = previousPrimaryRuns([
      run("run-1", 10, 1),
      child,
      run("run-3", 30, 3),
      run("run-2", 20, 2),
    ], "run-3");

    expect(selected.map((entry) => entry.runKey)).toEqual(["run-2", "run-1"]);
  });
});
