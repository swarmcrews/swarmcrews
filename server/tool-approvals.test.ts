import { describe, it, expect, vi, afterEach } from "vitest";
import { ToolApprovals } from "./tool-approvals.ts";

afterEach(() => vi.useRealTimers());
function setup() {
  const approvals = new ToolApprovals("session-a");
  const controller = new AbortController();
  const emit = vi.fn();
  const request = approvals.begin(controller.signal, emit);
  return { approvals, controller, emit, request };
}
describe("invocation-scoped tool approvals", () => {
  it("denies requests whose complete details cannot be inspected", async () => {
    const a = setup();
    const inputs: unknown[] = [{ command: " ".repeat(12_000) + "hidden action" }, { value: 1n }];
    for (const input of inputs) expect(await a.request({ tool: "Bash", input })).toBe("deny");
    expect(a.approvals.snapshot()).toEqual([]);
    expect(a.emit).not.toHaveBeenCalled();
  });
  it("settles exactly once and rejects cross-session and stale decisions", async () => {
    const a = setup(), b = setup();
    const pending = a.request({ tool: "Bash", input: { command: "pwd" } });
    const [record] = a.approvals.snapshot();
    expect(record).toMatchObject({ tool: "Bash", sessionKey: "session-a" });
    expect(b.approvals.decide(record!.id, "allow_once")).toBe(false);
    expect(a.approvals.decide(record!.id, "allow_once")).toBe(true);
    expect(a.approvals.decide(record!.id, "deny")).toBe(false);
    expect(await pending).toBe("allow_once");
    expect(a.approvals.snapshot()).toEqual([]);
  });
  it("denies on abort and cannot revive a closed invocation", async () => {
    const a = setup();
    const pending = a.request({ tool: "write", input: {} });
    a.controller.abort();
    expect(await pending).toBe("deny");
    expect(await a.request({ tool: "write", input: {} })).toBe("deny");
    expect(a.approvals.snapshot()).toEqual([]);
  });
  it("fences replacement invocations and stale cleanup", async () => {
    const a = setup();
    const old = a.request({ tool: "old", input: {} });
    const nextController = new AbortController();
    const next = a.approvals.begin(nextController.signal, a.emit);
    expect(await old).toBe("deny");
    expect(await a.request({ tool: "late", input: {} })).toBe("deny");
    const current = next({ tool: "new", input: {} });
    a.approvals.end(a.controller.signal);
    expect(a.approvals.snapshot()).toHaveLength(1);
    a.approvals.end(nextController.signal);
    expect(await current).toBe("deny");
  });
  it("expires requests without a browser and never restores callbacks on restart", async () => {
    vi.useFakeTimers();
    const a = setup();
    const pending = a.request({ tool: "shell", input: {} });
    const id = a.approvals.snapshot()[0]!.id;
    expect(new ToolApprovals("session-a").decide(id, "allow_once")).toBe(false);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await pending).toBe("deny");
    expect(a.approvals.snapshot()).toEqual([]);
    expect(a.approvals.decide(id, "allow_once")).toBe(false);
  });
  it("honors native request cancellation separately from invocation cancellation", async () => {
    const a = setup(), native = new AbortController();
    const pending = a.request({ tool: "shell", input: {} }, native.signal);
    native.abort();
    expect(await pending).toBe("deny");
    expect(a.approvals.snapshot()).toEqual([]);
  });
});
