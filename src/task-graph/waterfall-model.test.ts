import { describe, expect, it } from "vitest";
import { createGraphFixture } from "./fixtures.ts";
import { executionBounds, executionOrder, executionSegments, timeTick } from "./waterfall-model.ts";
const at = (seconds: number) => new Date(Date.UTC(2026, 8, 13, 12, 0, seconds)).toISOString();

describe("execution waterfall projection", () => {
  it("preserves actual retry gaps and deduplicates the current attempt", () => {
    const node = createGraphFixture(1).nodes[0]!;
    const first = { ...node.currentAttempt!, id: "first", number: 1, state: "failed" as const, startedAt: at(0), finishedAt: at(10) };
    const retry = { ...node.currentAttempt!, id: "retry", number: 2, startedAt: at(20), state: "running" as const };
    node.attemptHistory = [first, { ...retry, state: "queued" }];
    node.currentAttempt = retry;
    const segments = executionSegments(node, Date.parse(at(50)));
    expect(segments.map((s) => [s.start, s.end, s.running])).toEqual([
      [Date.parse(at(0)), Date.parse(at(10)), false], [Date.parse(at(20)), Date.parse(at(50)), true],
    ]);
    expect(executionSegments(node, Date.parse(at(55)))[0]).toEqual(segments[0]);
  });

  it("never invents execution for queued tasks or a finish time for failed history", () => {
    const node = createGraphFixture(1).nodes[0]!;
    node.attemptHistory = [];
    node.currentAttempt = { ...node.currentAttempt!, state: "queued", startedAt: at(0) };
    expect(executionSegments(node, Date.parse(at(50)))).toEqual([]);
    node.currentAttempt.state = "failed";
    expect(executionSegments(node, Date.parse(at(50)))[0]).toMatchObject({ start: Date.parse(at(0)), end: Date.parse(at(0)), finishUnknown: true, running: false });
    node.currentAttempt.startedAt = "invalid";
    expect(executionSegments(node, Date.parse(at(50)))).toEqual([]);
  });

  it("keeps dependency order independent of status, input ordering and priority", () => {
    const snapshot = createGraphFixture(5);
    snapshot.edges = [["node-0", "node-2"], ["node-1", "node-2"], ["node-2", "node-4"]].map(([source, target], i) => ({ id: String(i), source: source!, target: target!, type: "depends_on", state: "ordinary" }));
    const order = executionOrder(snapshot).map((n) => n.id);
    snapshot.nodes.reverse();
    snapshot.nodes.forEach((n) => { n.priority *= -1; n.logicalState = "succeeded"; n.criticalPath = !n.criticalPath; });
    expect(executionOrder(snapshot).map((n) => n.id)).toEqual(order);
    snapshot.edges.forEach((edge) => expect(order.indexOf(edge.source)).toBeLessThan(order.indexOf(edge.target)));
    snapshot.edges.push({ id: "cycle", source: "node-4", target: "node-0", type: "depends_on", state: "ordinary" });
    expect(new Set(executionOrder(snapshot).map((n) => n.id)).size).toBe(5);
  });

  it("uses finished timestamps for closed runs and handles empty graphs", () => {
    const snapshot = createGraphFixture(1);
    snapshot.nodes[0]!.attemptHistory = [];
    snapshot.nodes[0]!.currentAttempt = { ...snapshot.nodes[0]!.currentAttempt!, state: "succeeded", startedAt: at(0), finishedAt: at(17) };
    expect(executionBounds(snapshot, Date.parse(at(500))).duration).toBe(17_000);
    snapshot.nodes = [];
    expect(executionBounds(snapshot, Date.parse(at(500))).duration).toBe(0);
    expect(timeTick(0)).toBe(1000);
    expect(timeTick(36_000_000)).toBeGreaterThanOrEqual(36_000_000 / 6);
  });
});
