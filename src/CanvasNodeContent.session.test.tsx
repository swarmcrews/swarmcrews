import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasNodeContent } from "./CanvasNodeContent.tsx";
import { LeaderNodeRenderer, LEADER_DEFAULT_DATA, type LeaderData } from "./nodes/LeaderNode.tsx";
import { createReplaySocket } from "../tests/harness/ws-replay.ts";

let onVisible: IntersectionObserverCallback;
class Observer {
  constructor(callback: IntersectionObserverCallback) { onVisible = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
}
afterEach(() => vi.unstubAllGlobals());

it("recovers and persists an offscreen leader's session before hydrating its conversation", async () => {
  vi.stubGlobal("IntersectionObserver", Observer);
  const { socket, replay } = createReplaySocket();
  const saved = vi.fn();
  function Leader() {
    const [data, setData] = useState<LeaderData>({ ...LEADER_DEFAULT_DATA, sessionKey: "leader-offscreen" });
    return <div className="canvas-node-card">
      <CanvasNodeContent renderer={LeaderNodeRenderer} hiddenForDrag={false} isSelected={false}
        node={{ id: "leader", type: "leader", position: { x: 5000, y: 0 }, size: { width: 560, height: 520 }, data }}
        socketSend={socket.send} socketSubscribe={socket.subscribe}
        onUpdateData={next => { saved(next); setData(next as LeaderData); }} />
    </div>;
  }
  const { container } = render(<Leader />);
  const subscriptions = socket.subscriberCount;
  expect(subscriptions).toBeGreaterThan(0);
  expect(socket.sent).toContainEqual({ type: "sync_session", sessionKey: "leader-offscreen" });
  const feed = screen.getByLabelText("Conversation messages");
  expect(feed.firstElementChild).toBeEmptyDOMElement(); // Retain the scroll/content shells.
  await act(() => replay([{ message: {
    type: "sync_response", sessionKey: "leader-offscreen", found: true, status: "idle",
    events: [{ type: "sdk_event", sessionKey: "leader-offscreen", timestamp: 1,
      event: { kind: "text", role: "assistant", text: "Recovered while offscreen" } }],
  } }]));
  expect(saved.mock.lastCall?.[0].messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ content: "Recovered while offscreen" }),
  ]));
  expect(screen.queryByText("Recovered while offscreen")).not.toBeInTheDocument();
  const card = container.querySelector(".canvas-node-card")!;
  act(() => onVisible([{ target: card, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(screen.getByText("Recovered while offscreen")).toBeInTheDocument();
  expect(screen.getByLabelText("Conversation messages")).toBe(feed);
  expect(socket.subscriberCount).toBe(subscriptions);
  expect(socket.sent.filter((msg: unknown) => (msg as { type: string }).type === "sync_session")).toHaveLength(1);
});
