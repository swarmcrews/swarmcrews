import { describe, expect, it } from "vitest";
import type { MobileSessionInfo } from "./mobile/mobile-selectors.ts";
import { briefingEntries, captureBriefing, selectBriefingChanges, parseBriefingVisit } from "./activity-return-briefing.ts";

const session = (overrides: Partial<MobileSessionInfo> = {}): MobileSessionInfo => ({
  sessionKey: "s", sessionId: null, cwd: "/repo", status: "completed", lastActivityAt: 200,
  taskName: "Retry fix", lastActivity: "Regression tests passed", ...overrides,
});

describe("return briefing changes", () => {
  it("excludes active chatter and groups decisions, outcomes and interruptions", () => {
    const entries = briefingEntries([
      session({ sessionKey: "live", status: "running" }),
      session({ sessionKey: "decision", status: "waiting" }),
      session({ sessionKey: "done" }),
      session({ sessionKey: "error", status: "error" }),
    ]);
    expect(entries.map(e => [e.id, e.group])).toEqual([
      ["session:decision", "input"], ["session:done", "outcome"], ["session:error", "resume"],
    ]);
    expect(entries[1]?.label).toBe("Reported complete");
    expect(entries[1]?.detail).toBe("Regression tests passed");
  });

  it("turns report Markdown into a concise readable excerpt", () => {
    const report = "## **Result**\n- [x] Fixed `retry_count` in [worker](https://example.com/worker).\n> _Tests passed_.";
    expect(briefingEntries([session({ lastActivity: report })])[0]?.detail)
      .toBe("Result Fixed retry_count in worker. Tests passed.");
    const long = briefingEntries([session({ lastActivity: "**A readable result** ".repeat(30) })])[0]!.detail;
    expect(long.length).toBeLessThanOrEqual(180);
    expect(long).toMatch(/…$/);
    expect(long).not.toContain("**");
  });

  it("preserves literal identifiers and code while removing presentation syntax", () => {
    const report = "Updated retry_count and foo_bar_baz.\n```sh\npnpm test --run\n```\n~~Old result~~ **New result**";
    expect(briefingEntries([session({ lastActivity: report })])[0]?.detail)
      .toBe("Updated retry_count and foo_bar_baz. pnpm test --run Old result New result");
  });

  it("preserves existing browser visit signatures when only preview formatting changes", () => {
    const entry = briefingEntries([session({ lastActivity: "**Done**" })])[0]!;
    expect(entry.detail).toBe("Done");
    // Digest saved by the original briefing before display-only Markdown cleanup.
    expect(entry.signature).toBe("2f206f94");
    expect(selectBriefingChanges([entry], { version: 1, at: 300,
      signatures: { "session:s": "2f206f94" } }, 0)).toEqual([]);
  });

  it("does not rediscover unchanged decisions when chatter timestamps advance", () => {
    const before = session({ status: "waiting", lastActivity: "Choose a strategy" });
    const visit = captureBriefing([before], 300);
    expect(selectBriefingChanges(briefingEntries([{ ...before, lastActivityAt: 400 }]), visit, 0)).toEqual([]);
    expect(selectBriefingChanges(briefingEntries([{ ...before, lastActivity: "Choose a rollout window", lastActivityAt: 400 }]), visit, 0)).toHaveLength(1);
  });

  it("compares known work by meaningful state, including transitions without timestamps", () => {
    const visit = captureBriefing([session({ status: "running", lastActivityAt: null })], 300);
    expect(selectBriefingChanges(briefingEntries([session({ lastActivityAt: null })]), visit, 0)).toHaveLength(1);
    expect(selectBriefingChanges(briefingEntries([session({ sessionKey: "old", lastActivityAt: 100 })]), visit, 0)).toHaveLength(0);
  });

  it("uses a bounded time window without claiming full historical event coverage", () => {
    expect(selectBriefingChanges(briefingEntries([session(), session({ sessionKey: "old", lastActivityAt: 10 })]), null, 100)).toHaveLength(1);
    expect(selectBriefingChanges(briefingEntries([session({ lastActivityAt: null })]), null, 100)).toHaveLength(0);
  });

  it("deduplicates work items, prefers canonical state and excludes child or dismissed work", () => {
    const entries = briefingEntries([
      session({ sessionKey: "child", workItemId: "w", role: "minion" }),
      session({ sessionKey: "legacy", workItemId: "w", lastActivityAt: 900 }),
      session({ sessionKey: "canonical", workItemId: "w", canonicalWorkItem: true }),
      session({ sessionKey: "child-run", runKind: "child" }),
    ]);
    expect(entries.map(e => e.sessionKey)).toEqual(["canonical"]);
  });

  it("respects canonical active and automatic wait states over stale terminal state", () => {
    expect(briefingEntries([session({ workItemPresentation: {
      label: "Integrating", badge: "active", attentionRank: 4, needsAttention: false, availableActions: [],
    } })])).toEqual([]);
    expect(briefingEntries([session({ status: "waiting", workItemPresentation: {
      label: "Active", badge: "active", attentionRank: 4, needsAttention: false, availableActions: [],
    } })])).toEqual([]);
  });

  it("does not count a canonical review acknowledgment as a new outcome", () => {
    const completed = session({ canonicalWorkItem: true, lastActivity: "Ready for review",
      workItemPresentation: { label: "Ready for review", badge: "success", attentionRank: 3,
        needsAttention: true, availableActions: [] },
      reviewLifecycle: { reviewState: "completion_to_review", finalReport: null, reviewReason: "Ready for review",
        terminalAt: 100, terminalReason: "completed", acknowledgedAt: null, dismissedAt: null,
        lifecycleRevision: 1, dashboardRevision: 0, finalDashboardRevision: null },
    });
    const reviewed = { ...completed, lastActivity: "Reviewed", lastActivityAt: 500,
      workItemPresentation: { ...completed.workItemPresentation!, label: "Reviewed", needsAttention: false },
      reviewLifecycle: { ...completed.reviewLifecycle!, reviewReason: "Reviewed", terminalAt: 500,
        acknowledgedAt: 500, lifecycleRevision: 2 },
    };
    expect(selectBriefingChanges(briefingEntries([reviewed]), captureBriefing([completed], 300), 0)).toEqual([]);
    expect(briefingEntries([{ ...reviewed, reviewLifecycle: { ...reviewed.reviewLifecycle, dismissedAt: 600 } }])).toEqual([]);
  });

  it("does not turn a reviewed error's success-colored badge into a completion", () => {
    const failed = session({ canonicalWorkItem: true, status: "inactive", lastActivity: "Error",
      workItemPresentation: { label: "Error", badge: "error", attentionRank: 1, needsAttention: true, availableActions: [] },
      reviewLifecycle: { reviewState: "error_to_review", finalReport: "Failed", reviewReason: "Error",
        terminalAt: 100, terminalReason: "error", acknowledgedAt: null, dismissedAt: null,
        lifecycleRevision: 1, dashboardRevision: 0, finalDashboardRevision: null } });
    const reviewed = { ...failed, lastActivity: "Reviewed",
      workItemPresentation: { ...failed.workItemPresentation!, label: "Reviewed", badge: "success" as const, needsAttention: false },
      reviewLifecycle: { ...failed.reviewLifecycle!, acknowledgedAt: 500, terminalAt: 500, reviewReason: "Reviewed" } };
    expect(selectBriefingChanges(briefingEntries([reviewed]), captureBriefing([failed], 300), 0)).toEqual([]);
  });

  it("detects repeated legacy completions without using review revisions as events", () => {
    const completed = session({ reviewLifecycle: { reviewState: "completion_to_review", finalReport: "Done",
      reviewReason: null, terminalAt: 100, terminalReason: "completed", acknowledgedAt: null, dismissedAt: null,
      lifecycleRevision: 1, dashboardRevision: 0, finalDashboardRevision: null } });
    const repeated = { ...completed, reviewLifecycle: { ...completed.reviewLifecycle!, terminalAt: 500 } };
    expect(selectBriefingChanges(briefingEntries([repeated]), captureBriefing([completed], 300), 0)).toHaveLength(1);
  });

  it("canonical neutral states do not inherit stale legacy interruptions", () => {
    expect(briefingEntries([session({ status: "stopped", workItemPresentation: { label: "Draft", badge: "neutral",
      attentionRank: 4, needsAttention: false, availableActions: [] } })])).toEqual([]);
  });

  it("does not persist report or decision text and validates stored data", () => {
    const visit = captureBriefing([session()], 300);
    expect(JSON.stringify(visit)).not.toContain("Regression tests passed");
    expect(parseBriefingVisit(JSON.stringify(visit), 400)).toEqual(visit);
    for (const value of ["bad", "null", '{"version":1}', JSON.stringify({ ...visit, at: 900 }), JSON.stringify({ ...visit, signatures: [] })]) {
      expect(parseBriefingVisit(value, 400)).toBeNull();
    }
  });
});
