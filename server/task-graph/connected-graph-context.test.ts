import { describe, expect, it } from "vitest";
import { graphOverview } from "./connected-graph-context.ts";
import { boundHandoffText } from "../../shared/handoff-text.ts";

describe("connected graph overview budget", () => {
  it("retains identity, status and lookup hint in the retained head of a long source", () => {
    const overview = graphOverview({ plan: { objective: "x".repeat(20_000), state: "running",
      graphRunId: "graph", steps: Array.from({ length: 10 }, (_, i) => ({ key: `step-${i}`, title: "y".repeat(20_000) })) },
      runtime: { nodes: [{}] } })!;
    expect(overview.length).toBeLessThanOrEqual(2_000);
    const excerpt = boundHandoffText(`${overview}\n${"transcript".repeat(20_000)}`, 7_500);
    expect(excerpt).toContain("Status: running");
    expect(excerpt).toContain("connectedSourceId");
    expect(excerpt).toContain("Topology:");
  });
  it("does not fabricate an overview without a plan", () => {
    expect(graphOverview({ plan: null, runtime: null })).toBeNull();
  });
});
