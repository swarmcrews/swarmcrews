import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraphFixture } from "./fixtures.ts";
import { GraphInspector } from "./GraphInspector.tsx";
import { Waterfall } from "./Waterfall.tsx";
import type { TaskGraphSnapshotView } from "./types.ts";

const at = (s: number) => new Date(Date.UTC(2026, 8, 13, 12, 0, s)).toISOString();
function fixture(): TaskGraphSnapshotView {
  const snapshot = createGraphFixture(3);
  snapshot.updatedAt = at(50);
  snapshot.nodes.forEach((node) => { node.attemptHistory = []; node.blocker = null; });
  snapshot.nodes[0]!.logicalState = "succeeded";
  snapshot.nodes[0]!.currentAttempt = { ...snapshot.nodes[0]!.currentAttempt!, state: "succeeded", startedAt: at(0), finishedAt: at(10) };
  snapshot.nodes[1]!.currentAttempt = { ...snapshot.nodes[1]!.currentAttempt!, state: "running", startedAt: at(20) };
  snapshot.nodes[2]!.currentAttempt = { ...snapshot.nodes[2]!.currentAttempt!, state: "queued", startedAt: at(40) };
  return snapshot;
}
afterEach(() => vi.useRealTimers());

describe("Waterfall", () => {
  it("grows only running segments at a fixed scale without reordering lanes", () => {
    vi.useFakeTimers(); vi.setSystemTime(at(50));
    const snapshot = fixture();
    const { container } = render(<Waterfall snapshot={snapshot} filter="all" selectedNodeId={null} onSelect={vi.fn()} />);
    const active = container.querySelector<HTMLElement>('[data-attempt-id="attempt-1-2"]')!;
    const completed = container.querySelector<HTMLElement>('[data-attempt-id="attempt-0-2"]')!;
    const width = parseFloat(active.style.width), finishedWidth = completed.style.width;
    const lanes = [...container.querySelectorAll<HTMLElement>('[data-node-id]')].map((el) => [el.dataset["nodeId"], el.style.top]);
    expect(active.dataset["durationMs"]).toBe("30000");
    act(() => vi.advanceTimersByTime(5000));
    expect(active.dataset["durationMs"]).toBe("35000");
    expect(parseFloat(active.style.width)).toBeGreaterThan(width);
    expect(completed.style.width).toBe(finishedWidth);
    expect([...container.querySelectorAll<HTMLElement>('[data-node-id]')].map((el) => [el.dataset["nodeId"], el.style.top])).toEqual(lanes);
    expect(container.querySelector('[data-attempt-id="attempt-2-2"]')).toBeNull();
    expect(screen.getByText(/Not started/)).toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });

  it("freezes disconnected and historical views at the recorded snapshot", () => {
    vi.useFakeTimers(); vi.setSystemTime(at(100));
    const { container, rerender } = render(<Waterfall snapshot={fixture()} filter="all" selectedNodeId={null} live={false} onSelect={vi.fn()} />);
    const duration = () => container.querySelector('[data-attempt-id="attempt-1-2"]')?.getAttribute('data-duration-ms');
    expect(duration()).toBe("30000");
    act(() => vi.advanceTimersByTime(8000));
    expect(duration()).toBe("30000");
    expect(vi.getTimerCount()).toBe(0);
    rerender(<Waterfall snapshot={fixture()} filter="all" selectedNodeId={null} live onSelect={vi.fn()} />);
    expect(duration()).toBe("88000");
  });

  it("preserves graph selection and filters when switching visualizations", () => {
    vi.useFakeTimers(); vi.setSystemTime(at(50));
    const { baseElement: container } = render(<GraphInspector snapshot={fixture()} onAction={vi.fn()} onClose={vi.fn()} />);
    const flow = screen.getByRole("tab", { name: "Flow" });
    fireEvent.keyDown(flow, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Waterfall" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Waterfall" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(container.querySelector('[data-node-id="node-1"] .tg-waterfall__label')!);
    expect(container.querySelector('[data-node-id="node-1"] .tg-waterfall__label')).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(flow);
    expect(container.querySelector('.tg-flow-node.is-selected')).toHaveTextContent("Task 1");
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    fireEvent.click(screen.getByRole("tab", { name: "Waterfall" }));
    expect(screen.getByText("No tasks match this filter.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(container.querySelector('[data-node-id="node-1"] .tg-waterfall__label')).toHaveAttribute("aria-pressed", "true");
  });
});
