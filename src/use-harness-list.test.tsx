import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HarnessListProvider, useHarnessList } from "./use-harness-list.tsx";
import type { HarnessListEntry } from "./use-socket.ts";

const entry = (name: string, model: string): HarnessListEntry => ({
  name, models: [{ id: model, label: model }], capabilities: {} as HarnessListEntry["capabilities"],
  builtInTools: [], commands: [], agents: [], account: { provider: name },
});
function View() {
  const { harnesses, loaded } = useHarnessList();
  return <p>{loaded ? harnesses.map(h => `${h.name}:${h.models[0]?.id}`).join(",") : "loading"}</p>;
}

describe("HarnessListProvider", () => {
  it("replaces a later single-entry snapshot without retaining removed harnesses", () => {
    const listeners = new Set<(msg: unknown) => void>();
    const subscribe = (fn: (msg: unknown) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
    const send = () => { for (const listener of listeners) listener({ type: "harness_list", catalogMode: "snapshot", harnesses: [entry("claude", "c1"), entry("pi", "p1")] }); };
    render(<HarnessListProvider connected send={send} subscribe={subscribe}><View /></HarnessListProvider>);
    expect(screen.getByText("claude:c1,pi:p1")).toBeInTheDocument();
    act(() => { for (const listener of listeners) listener({ type: "harness_list", catalogMode: "snapshot", harnesses: [entry("claude", "c2")] }); });
    expect(screen.getByText("claude:c2")).toBeInTheDocument();
  });

  it("subscribes before synchronous send, merges singleton progress, deduplicates, and resets on reconnect", () => {
    const listeners = new Set<(msg: unknown) => void>();
    const subscribe = vi.fn((fn: (msg: unknown) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; });
    const send = vi.fn(() => { for (const listener of listeners) listener({ type: "harness_list", harnesses: [entry("claude", "c1"), entry("pi", "p1")] }); });
    const view = render(<HarnessListProvider connected send={send} subscribe={subscribe}><View /></HarnessListProvider>);
    expect(screen.getByText("claude:c1,pi:p1")).toBeInTheDocument();
    expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
    act(() => { for (const listener of listeners) listener({ type: "harness_list", catalogMode: "patch", harnesses: [entry("claude", "c2")] }); });
    expect(screen.getByText("claude:c2,pi:p1")).toBeInTheDocument();
    act(() => { for (const listener of listeners) listener({ type: "harness_list", catalogMode: "patch", harnesses: [entry("claude", "c2")] }); });
    expect(screen.getByText("claude:c2,pi:p1")).toBeInTheDocument();
    view.rerender(<HarnessListProvider connected={false} send={send} subscribe={subscribe}><View /></HarnessListProvider>);
    expect(listeners.size).toBe(0);
    view.rerender(<HarnessListProvider connected send={send} subscribe={subscribe}><View /></HarnessListProvider>);
    expect(send).toHaveBeenCalledTimes(2);
    expect(screen.getByText("claude:c1,pi:p1")).toBeInTheDocument();
  });
});
