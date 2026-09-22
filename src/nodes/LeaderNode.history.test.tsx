import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LeaderNodeRenderer, LEADER_DEFAULT_DATA, type LeaderData } from "./LeaderNode.tsx";
import type { ServerMessage, SocketSubscribe } from "../use-socket.ts";
import type { WorkItemRunSnapshot, WorkItemSnapshot } from "../../shared/work-item-contracts.ts";

beforeAll(() => {
  if (typeof ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function run(number: number): WorkItemRunSnapshot {
  return {
    runKey: `run-${number}`, workItemId: "work-1", runKind: "primary",
    parentRunKey: null, taskId: null, runNumber: number,
    previousRunKey: number > 1 ? `run-${number - 1}` : null,
    providerSessionId: null, outcome: "completed", startedAt: number,
    endedAt: number + 1, finalReport: null,
  };
}

describe("Canvas leader iteration history", () => {
  it.each(["receipt-first", "event-first"])("keeps a submitted iteration prompt in its new run only (%s)", async (order) => {
    const listeners = new Set<(message: unknown) => void>();
    const subscribe = (listener: (message: unknown) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    };
    const emit = (message: unknown) => act(async () => {
      for (const listener of [...listeners]) listener(message);
    });
    const send = vi.fn();
    const completed: WorkItemSnapshot = {
      id: "work-1", projectId: "project-1", projectPath: "/repo", title: "Task",
      lifecycle: { runtimeState: "inactive", outcome: "completed", resolution: "open",
        changeMode: "live", integrationState: "live_clean", lifecycleRevision: 2 },
      waitKind: null, currentRunKey: "run-1", iteration: 1,
      lastTransitionAt: 2, createdAt: 1, updatedAt: 2,
    };
    const next: WorkItemSnapshot = { ...completed, currentRunKey: "run-2", iteration: 2,
      lifecycle: { ...completed.lifecycle, runtimeState: "working", outcome: "none", lifecycleRevision: 3 } };
    function Probe() {
      const [data, setData] = useState<LeaderData>({ ...LEADER_DEFAULT_DATA,
        workItemId: "work-1", workItemSnapshot: completed, sessionKey: "run-1", currentRunKey: "run-1", status: "completed",
        messages: [
          { id: "original", role: "user", content: "Original request", timestamp: 1, optimistic: true },
          { id: "answer", role: "assistant", content: "Previous answer", timestamp: 2 },
        ],
        messageDelivery: { original: { state: "accepted", text: "Original request" } },
      });
      return <LeaderNodeRenderer node={{ id: "prompt-history", type: "leader",
        position: { x: 0, y: 0 }, size: { width: 560, height: 520 }, data }}
        isSelected={false} socketSend={send} socketSubscribe={subscribe}
        onUpdateData={(next) => setData(next as LeaderData)} />;
    }
    render(<Probe />);
    await emit({ type: "work_item_response", command: "get_work_item_runs", success: true,
      result: { workItemId: "work-1", runs: [run(1)], nextCursor: null } });
    fireEvent.change(screen.getByTestId("leader-prompt-input-inline"), { target: { value: "Next iteration prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "New iteration" }));
    const command = send.mock.calls.find(([command]) => command.type === "continue_work_item")?.[0];
    expect(command).toBeDefined();
    expect(within(screen.getByLabelText("Conversation messages")).getAllByText("Next iteration prompt")).toHaveLength(1);
    const receipt = { type: "work_item_response", command: "continue_work_item", requestId: command.requestId,
      success: true, result: { workItem: next, currentRun: run(2), runs: [], bindings: [], nextCursor: null } };
    if (order === "receipt-first") await emit(receipt);
    await emit({ type: "work_item_run_created", workItemId: "work-1", run: { ...run(2), outcome: "none" } });
    await emit({ type: "work_item_changed", workItem: next });
    await emit({ type: "sdk_event", sessionKey: "run-2", timestamp: 3,
      event: { kind: "text", role: "user", id: "server-prompt", text: "Next iteration prompt" } });
    if (order === "event-first") await emit(receipt);
    const checkFeed = (feed: HTMLElement) => {
      expect(within(feed).getAllByText("Original request")).toHaveLength(1);
      expect(within(feed).getByText("Previous answer")).toBeInTheDocument();
      const prompts = within(feed).getAllByText("Next iteration prompt");
      expect(prompts).toHaveLength(1);
      const boundary = within(feed).getByRole("navigation", { name: "Iteration 2 navigation" });
      expect(boundary.compareDocumentPosition(prompts[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };
    checkFeed(screen.getByLabelText("Conversation messages"));
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    checkFeed(screen.getByRole("region", { name: "Conversation messages" }));
  });

  it.each(["topics", "legacy"])("progressively loads iterations in card and fullscreen with %s sockets", (mode) => {
    const listeners = new Set<(message: unknown) => void>();
    const subscribe = Object.assign((topicOrListener: string | ((message: unknown) => void),
      callback?: (message: unknown) => void) => {
      const listener = typeof topicOrListener === "function" ? topicOrListener : callback!;
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }, mode === "topics" ? { supportsTopics: true as const } : {});
    const emit = (message: unknown) => act(() => {
      for (const listener of [...listeners]) listener(message);
    });
    const send = vi.fn();
    const persisted: LeaderData[] = [];
    function Probe() {
      const [data, setData] = useState<LeaderData>({ ...LEADER_DEFAULT_DATA,
        workItemId: "work-1", sessionKey: "run-3", currentRunKey: "run-3", status: "running",
        messages: [{ id: "current", role: "assistant", content: "Current conversation", timestamp: 3 }],
      });
      return <LeaderNodeRenderer node={{ id: "history-leader", type: "leader",
        position: { x: 0, y: 0 }, size: { width: 560, height: 520 }, data }}
        isSelected={false} socketSend={send} socketSubscribe={subscribe as SocketSubscribe}
        onUpdateData={(next) => { persisted.push(next as LeaderData); setData(next as LeaderData); }} />;
    }
    render(<Probe />);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "get_work_item_runs", workItemId: "work-1" }));
    emit({ type: "work_item_response", command: "get_work_item_runs", success: true,
      result: { workItemId: "work-1", runs: [run(3), run(2)], nextCursor: "older" } });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "get_work_item_runs", cursor: "older" }));
    emit({ type: "work_item_response", command: "get_work_item_runs", success: true,
      result: { workItemId: "work-1", runs: [run(1), { ...run(1), runKey: "child", runKind: "child" }], nextCursor: null } });
    expect(send).not.toHaveBeenCalledWith({ type: "sync_session", sessionKey: "child" });
    for (const number of [1, 2]) {
      expect(send).toHaveBeenCalledWith({ type: "sync_session", sessionKey: `run-${number}` });
      emit({ type: "sync_response", found: true, sessionKey: `run-${number}`, status: "completed",
        events: [{ type: "sdk_event", sessionKey: `run-${number}`, timestamp: number,
          event: { kind: "text", role: "assistant", text: `Earlier conversation ${number}` } }] });
    }
    const card = screen.getByLabelText("Conversation messages");
    expect(within(card).getByText("Earlier conversation 1")).toBeInTheDocument();
    expect(within(card).getByText("Earlier conversation 2")).toBeInTheDocument();
    expect(within(card).getAllByText("Current conversation")).toHaveLength(1);
    expect(screen.queryByText("Loading iteration history…")).not.toBeInTheDocument();

    // Reading an earlier iteration must survive live output in the current run.
    Object.defineProperties(card, {
      clientHeight: { configurable: true, value: 200 },
      clientWidth: { configurable: true, value: 500 },
      scrollHeight: { configurable: true, value: 1200 },
    });
    fireEvent.scroll(card); // establish layout geometry
    const first = within(card).getByRole("navigation", { name: "Iteration 1 navigation" });
    first.scrollIntoView = vi.fn(() => { card.scrollTop = 100; });
    fireEvent.click(within(card).getByRole("button", { name: "Previous: Iteration 1" }));
    expect(first).toHaveFocus();
    emit({ type: "sdk_event", sessionKey: "run-3", timestamp: 4,
      event: { kind: "text", role: "assistant", text: "New live output" } } satisfies ServerMessage);
    expect(card.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: /Jump to latest/ })).toBeInTheDocument();
    expect(persisted.at(-1)?.messages.map((message) => message.content))
      .toEqual(["Current conversation", "New live output"]);

    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    const fullscreen = screen.getByRole("region", { name: "Conversation messages" });
    expect(within(fullscreen).getByText("Earlier conversation 1")).toBeInTheDocument();
    expect(within(fullscreen).getByText("Current conversation")).toBeInTheDocument();
    const fullscreenFirst = within(fullscreen).getByRole("navigation", { name: "Iteration 1 navigation" });
    fullscreenFirst.scrollIntoView = vi.fn();
    fireEvent.click(within(fullscreen).getByRole("button", { name: "Previous: Iteration 1" }));
    expect(fullscreenFirst.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(fullscreenFirst).toHaveFocus();
    expect(first.id).not.toBe(fullscreenFirst.id);

    send.mockClear();
    emit({ type: "socket_reconnected" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "get_work_item_runs", cursor: undefined }));
    expect(send).toHaveBeenCalledWith({ type: "sync_session", sessionKey: "run-1" });
    // Other leaders' ledger pages must not appear in this conversation.
    emit({ type: "work_item_response", command: "get_work_item_runs", success: true,
      result: { workItemId: "other-work", runs: [{ ...run(9), workItemId: "other-work" }], nextCursor: null } });
    expect(send).not.toHaveBeenCalledWith({ type: "sync_session", sessionKey: "run-9" });

    // A new primary run replaces the live stream, retaining the old one in history.
    // The old run's replay may still be in flight when the new iteration starts.
    // Preserve both the restored transcript and the live output already displayed.
    emit({ type: "work_item_run_created", workItemId: "work-1", run: { ...run(4), outcome: "none" } });
    emit({ type: "work_item_changed", workItem: {
      id: "work-1", projectId: "project-1", projectPath: "/repo", title: "History task",
      lifecycle: { runtimeState: "working", outcome: "none", resolution: "open",
        changeMode: "live", integrationState: "live_clean", lifecycleRevision: 4 },
      waitKind: null, currentRunKey: "run-4", iteration: 4,
      lastTransitionAt: 4, createdAt: 1, updatedAt: 4,
    } });
    emit({ type: "sdk_event", sessionKey: "run-4", timestamp: 4,
      event: { kind: "text", role: "assistant", text: "Fourth iteration output" } });
    const nextFullscreen = screen.getByRole("region", { name: "Conversation messages" });
    expect(within(nextFullscreen).queryByText("Earlier conversation 1")).not.toBeInTheDocument();
    fireEvent.click(within(nextFullscreen).getByRole("button", { name: /Browse older iterations/ }));
    fireEvent.click(within(nextFullscreen).getByRole("button", { name: /Iteration 1 · completed/ }));
    expect(send).toHaveBeenLastCalledWith({ type: "sync_session", sessionKey: "run-1" });
    emit({ type: "sync_response", found: true, sessionKey: "run-1", status: "completed",
      events: [{ type: "sdk_event", sessionKey: "run-1", timestamp: 1,
        event: { kind: "text", role: "assistant", text: "Earlier conversation 1" } }] });
    expect(within(nextFullscreen).getByText("Earlier conversation 1")).toBeInTheDocument();
    expect(within(nextFullscreen).getAllByText("Current conversation")).toHaveLength(1);
    expect(within(nextFullscreen).getAllByText("New live output")).toHaveLength(1);
    expect(within(nextFullscreen).getByText("Fourth iteration output")).toBeInTheDocument();
    expect(persisted.at(-1)?.messages.map((message) => message.content)).toEqual(["Fourth iteration output"]);
    // A delayed replay replaces the cached copy without duplicating messages.
    emit({ type: "sync_response", found: true, sessionKey: "run-3", status: "completed",
      events: ["Current conversation", "New live output"].map((text, index) => ({
        type: "sdk_event", sessionKey: "run-3", timestamp: 3 + index,
        event: { kind: "text", role: "assistant", text },
      })) });
    fireEvent.keyDown(window, { key: "Escape" });
    const nextCard = screen.getByLabelText("Conversation messages");
    expect(within(nextCard).queryByText("Earlier conversation 1")).not.toBeInTheDocument();
    expect(within(nextCard).getByRole("button", { name: /Browse older iterations/ })).toBeInTheDocument();
    expect(within(nextCard).getAllByText("Current conversation")).toHaveLength(1);
    expect(within(nextCard).getAllByText("New live output")).toHaveLength(1);
    expect(within(nextCard).getByText("Fourth iteration output")).toBeInTheDocument();
  });
});
