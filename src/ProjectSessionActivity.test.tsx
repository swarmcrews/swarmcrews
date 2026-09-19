import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSessionActivity } from "./ProjectSessionActivity.tsx";
import { getProjectActivitySummary } from "./api.ts";

vi.mock("./api.ts", () => ({ getProjectActivitySummary: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getProjectActivitySummary).mockReset().mockResolvedValue([{ projectId: "p", activeSessions: 1 }]);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("badge summary refresh", () => {
  it("refreshes counts without overlapping requests and stops on unmount", async () => {
    const onSummaryChange = vi.fn();
    const view = render(<ProjectSessionActivity projectIds={["p"]} onSummaryChange={onSummaryChange} />);
    await act(async () => {});
    expect(onSummaryChange).toHaveBeenCalledWith([{ projectId: "p", activeSessions: 1 }]);
    const signal = vi.mocked(getProjectActivitySummary).mock.calls[0]![1]!;
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(getProjectActivitySummary).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(getProjectActivitySummary).toHaveBeenCalledTimes(2);
  });

  it("ignores old scope responses after project changes", async () => {
    let resolve!: (summary: Awaited<ReturnType<typeof getProjectActivitySummary>>) => void;
    vi.mocked(getProjectActivitySummary).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const onSummaryChange = vi.fn();
    const view = render(<ProjectSessionActivity projectIds={["old"]} onSummaryChange={onSummaryChange} />);
    const signal = vi.mocked(getProjectActivitySummary).mock.calls[0]![1]!;
    view.rerender(<ProjectSessionActivity projectIds={["p"]} onSummaryChange={onSummaryChange} />);
    await act(async () => { resolve([{ projectId: "old", activeSessions: 99 }]); });
    expect(signal.aborted).toBe(true);
    expect(onSummaryChange).toHaveBeenCalledTimes(1);
    expect(onSummaryChange).toHaveBeenCalledWith([{ projectId: "p", activeSessions: 1 }]);
  });

  it("pauses while hidden and refreshes on return", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<ProjectSessionActivity projectIds={["p"]} onSummaryChange={vi.fn()} />);
    expect(getProjectActivitySummary).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(getProjectActivitySummary).toHaveBeenCalledTimes(1);
  });

  it("retries a failed summary without inventing a zero count", async () => {
    vi.mocked(getProjectActivitySummary).mockRejectedValueOnce(new Error("offline"));
    const onSummaryChange = vi.fn();
    render(<ProjectSessionActivity projectIds={["p"]} onSummaryChange={onSummaryChange} />);
    await act(async () => {});
    expect(onSummaryChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(onSummaryChange).toHaveBeenCalledWith([{ projectId: "p", activeSessions: 1 }]);
  });
});
