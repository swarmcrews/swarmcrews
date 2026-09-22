import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ActivitySessionHome,
  selectRelevantSessions,
} from "./ActivitySessionHome.tsx";
import type { MobileSessionInfo } from "./mobile/mobile-selectors.ts";

function session(overrides: Partial<MobileSessionInfo>): MobileSessionInfo {
  return {
    sessionKey: overrides.sessionKey ?? "s-1",
    sessionId: null,
    status: overrides.status ?? "idle",
    cwd: "/tmp/project",
    ...overrides,
  };
}

describe("selectRelevantSessions", () => {
  it("prioritizes required decisions, review work, live work, then recency", () => {
    const ranked = selectRelevantSessions([
      session({ sessionKey: "recent", taskName: "Recent idle", lastActivityAt: 900 }),
      session({ sessionKey: "running", taskName: "Running", status: "running", lastActivityAt: 100 }),
      session({
        sessionKey: "review",
        taskName: "Review",
        status: "completed",
        reviewLifecycle: {
          reviewState: "completion_to_review",
          reviewReason: null,
          finalReport: null,
          finalDashboardRevision: null,
          dashboardRevision: 0,
          terminalReason: "completed",
          terminalAt: 200,
          acknowledgedAt: null,
          dismissedAt: null,
          lifecycleRevision: 1,
        },
      }),
      session({
        sessionKey: "decision",
        taskName: "Decision",
        status: "waiting",
        reviewLifecycle: {
          reviewState: "decision_needed",
          reviewReason: "Choose a migration strategy",
          finalReport: null,
          finalDashboardRevision: null,
          dashboardRevision: 0,
          terminalReason: null,
          terminalAt: null,
          acknowledgedAt: null,
          dismissedAt: null,
          lifecycleRevision: 2,
        },
      }),
    ]);

    expect(ranked.map((entry) => entry.sessionKey)).toEqual([
      "decision",
      "review",
      "running",
      "recent",
    ]);
  });

  it("does not keep acknowledged review work ahead of active work", () => {
    const acknowledged = session({
      sessionKey: "acknowledged",
      status: "completed",
      reviewLifecycle: {
        reviewState: "completion_to_review",
        reviewReason: null,
        finalReport: "Already reviewed.",
        finalDashboardRevision: null,
        dashboardRevision: 0,
        terminalReason: "completed",
        terminalAt: 500,
        acknowledgedAt: 600,
        dismissedAt: null,
        lifecycleRevision: 3,
      },
    });
    const running = session({ sessionKey: "running", status: "running", lastActivityAt: 10 });

    expect(selectRelevantSessions([acknowledged, running])[0]?.sessionKey).toBe("running");
  });
});

describe("ActivitySessionHome", () => {
  it("shows every active task above a visible recent-work review list", () => {
    const onOpenSession = vi.fn();
    render(<ActivitySessionHome sessions={[
      session({ sessionKey: "done", taskName: "Completed audit", status: "completed", lastActivity: "Review the findings" }),
      ...Array.from({ length: 5 }, (_, index) => session({
        sessionKey: `live-${index}`, taskName: `Live task ${index}`, status: "running",
      })),
      session({ sessionKey: "starting", taskName: "Starting task", status: "creating" }),
      session({ sessionKey: "waiting", taskName: "Approval task", status: "waiting" }),
    ]} onOpenSession={onOpenSession} onLaunch={() => {}} />);

    const active = screen.getByRole("region", { name: "Active tasks" });
    const recent = screen.getByRole("region", { name: "Recent work" });
    expect(within(active).getAllByRole("article")).toHaveLength(6);
    expect(within(active).getByText("Starting task")).toBeVisible();
    expect(within(active).queryByText("Approval task")).not.toBeInTheDocument();
    expect(within(recent).getByText("Approval task")).toBeVisible();
    expect(within(active).queryByText("Completed audit")).not.toBeInTheDocument();
    expect(within(recent).getByText("Completed audit")).toBeVisible();
    expect(within(recent).queryByText("Live task 0")).not.toBeInTheDocument();
    expect(active.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(recent).getByRole("button", { name: /completed audit/i }));
    expect(onOpenSession).toHaveBeenCalledWith("done");
  });

  it.each([
    { label: "Decision needed", needsAttention: true },
    { label: "Waiting for files", needsAttention: true },
    { label: "Waiting", needsAttention: false },
  ])("keeps $label tasks out of the active row, even with stale running status", (presentation) => {
    render(<ActivitySessionHome sessions={[
      session({ sessionKey: "waiting", taskName: "Paused task", status: "running",
        workItemPresentation: { ...presentation, badge: "waiting", attentionRank: 0, availableActions: [] },
      }),
      session({ sessionKey: "legacy", taskName: "Waiting legacy task", status: "waiting" }),
    ]} onOpenSession={() => {}} onLaunch={() => {}} />);
    expect(screen.queryByRole("region", { name: "Active tasks" })).not.toBeInTheDocument();
    const recent = screen.getByRole("region", { name: "Recent work" });
    expect(within(recent).getByText("Paused task")).toBeVisible();
    expect(within(recent).getByText("Waiting legacy task")).toBeVisible();
  });

  it("removes a task from monitoring when it waits and restores it when it resumes", () => {
    const props = { onOpenSession: vi.fn(), onLaunch: vi.fn() };
    const { rerender } = render(<ActivitySessionHome {...props} sessions={[
      session({ taskName: "Live task", status: "running" }),
    ]} />);
    expect(screen.getByRole("region", { name: "Active tasks" })).toBeVisible();
    rerender(<ActivitySessionHome {...props} sessions={[
      session({ taskName: "Live task", status: "waiting" }),
    ]} />);
    expect(screen.queryByRole("region", { name: "Active tasks" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent work" })).getByText("Live task")).toBeVisible();
    rerender(<ActivitySessionHome {...props} sessions={[
      session({ taskName: "Live task", status: "running" }),
    ]} />);
    expect(within(screen.getByRole("region", { name: "Active tasks" })).getByText("Live task")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Recent work" })).queryByText("Live task")).not.toBeInTheDocument();
  });

  it("uses canonical status to group work and shows current activity on live cards", () => {
    render(<ActivitySessionHome sessions={[
      session({ sessionKey: "live", taskName: "Integrating task", status: "completed",
        lastActivity: "Applying the patch",
        workItemPresentation: { label: "Integrating", badge: "active", attentionRank: 4,
          needsAttention: false, availableActions: [] },
        reviewLifecycle: { reviewState: "none", finalReport: "Previous run finished",
          reviewReason: null, finalDashboardRevision: null, dashboardRevision: 0,
          terminalReason: "completed", terminalAt: 20, acknowledgedAt: null,
          dismissedAt: null, lifecycleRevision: 1 },
      }),
      session({ sessionKey: "done", taskName: "Finished task", status: "running",
        workItemPresentation: { label: "Completed", badge: "success", attentionRank: 5,
          needsAttention: false, availableActions: [] },
      }),
    ]} onOpenSession={() => {}} onLaunch={() => {}} />);
    const active = screen.getByRole("region", { name: "Active tasks" });
    expect(within(active).getByText("Integrating")).toBeVisible();
    expect(within(active).getByText("Applying the patch")).toBeVisible();
    expect(within(active).queryByText("Previous run finished")).not.toBeInTheDocument();
    expect(within(active).queryByText("Finished task")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent work" }))
      .getByText("Finished task")).toBeVisible();
  });

  it("moves finished tasks from live cards into the review list on updates", () => {
    const props = { onOpenSession: vi.fn(), onLaunch: vi.fn() };
    const { rerender } = render(<ActivitySessionHome {...props} sessions={[
      session({ taskName: "Live task", status: "running" }),
    ]} />);
    expect(screen.getByText("No recently completed work to review yet.")).toBeVisible();
    rerender(<ActivitySessionHome {...props} sessions={[
      session({ taskName: "Live task", status: "completed" }),
    ]} />);
    expect(screen.queryByRole("region", { name: "Active tasks" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No active tasks/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent work" }))
      .getByText("Live task")).toBeVisible();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("shows newest completed work before old unresolved errors and decisions", () => {
    const lifecycle = (reviewState: "decision_needed" | "completion_to_review" | "error_to_review", terminalAt: number | null) => ({
      reviewState, terminalAt, finalReport: null, reviewReason: null,
      finalDashboardRevision: null, dashboardRevision: 0, terminalReason: null,
      acknowledgedAt: null, dismissedAt: null, lifecycleRevision: 1,
    });
    render(<ActivitySessionHome sessions={[
      session({ sessionKey: "old-decision", taskName: "Old decision", status: "inactive",
        lastActivityAt: 10, reviewLifecycle: lifecycle("decision_needed", null) }),
      session({ sessionKey: "old-error", taskName: "Old error", status: "error",
        lastActivityAt: 20, reviewLifecycle: lifecycle("error_to_review", 20) }),
      session({ sessionKey: "done", taskName: "Latest completed work", status: "completed",
        lastActivityAt: 100, reviewLifecycle: lifecycle("completion_to_review", 100) }),
      session({ sessionKey: "recent", taskName: "Recent completed work", status: "completed",
        lastActivityAt: 90, reviewLifecycle: lifecycle("completion_to_review", 90) }),
    ]} onOpenSession={() => {}} onLaunch={() => {}} />);
    expect(screen.queryByRole("region", { name: "Active tasks" })).not.toBeInTheDocument();
    const rows = within(screen.getByRole("region", { name: "Recent work" })).getAllByRole("button");
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
      "Latest completed work", "Recent completed work", "Old error", "Old decision",
    ]);
  });

  it("invites users to open a structured report instead of showing evidence in the preview", () => {
    render(<ActivitySessionHome sessions={[session({ taskName: "Audit changes",
      lastActivity: JSON.stringify({ summary: "Audit finished", nextSteps: ["Review findings"] }) })]}
      onOpenSession={() => {}} onLaunch={() => {}} />);
    expect(screen.getByRole("button", { name: /audit changes/i }))
      .toHaveTextContent("Agent report available. Open session to view details.");
  });

  it("uses neutral copy when every summary candidate repeats the session title", () => {
    render(
      <ActivitySessionHome
        sessions={[
          session({
            sessionKey: "primary",
            taskName: "Release checklist",
            status: "running",
            lastActivity: "  release CHECKLIST  ",
            reviewLifecycle: {
              reviewState: "none",
              reviewReason: "release checklist",
              finalReport: " RELEASE CHECKLIST ",
              finalDashboardRevision: null,
              dashboardRevision: 0,
              terminalReason: null,
              terminalAt: null,
              acknowledgedAt: null,
              dismissedAt: null,
              lifecycleRevision: 1,
            },
          }),
        ]}
        onOpenSession={() => {}}
        onLaunch={() => {}}
      />,
    );

    const primary = document.querySelector(".act-session-feature")!;
    expect(primary.querySelector(".act-session-feature__body p"))
      .toHaveTextContent("This session is in progress");
  });

  it("keeps the first distinct final report, activity, or review reason", () => {
    const lifecycle = (
      overrides: Partial<NonNullable<MobileSessionInfo["reviewLifecycle"]>>,
    ): NonNullable<MobileSessionInfo["reviewLifecycle"]> => ({
      reviewState: "none",
      reviewReason: null,
      finalReport: null,
      finalDashboardRevision: null,
      dashboardRevision: 0,
      terminalReason: null,
      terminalAt: null,
      acknowledgedAt: null,
      dismissedAt: null,
      lifecycleRevision: 1,
      ...overrides,
    });

    render(
      <ActivitySessionHome
        sessions={[
          session({
            sessionKey: "report",
            taskName: "Release checklist",
            lastActivityAt: 300,
            lastActivity: "Release checklist",
            reviewLifecycle: lifecycle({ finalReport: "Deployment is ready" }),
          }),
          session({
            sessionKey: "activity",
            taskName: "Dependency audit",
            lastActivityAt: 200,
            lastActivity: "Checking production licenses",
            reviewLifecycle: lifecycle({ finalReport: "dependency audit" }),
          }),
          session({
            sessionKey: "reason",
            taskName: "Migration plan",
            lastActivityAt: 100,
            lastActivity: "migration plan",
            reviewLifecycle: lifecycle({
              finalReport: " Migration Plan ",
              reviewReason: "Choose the rollout window",
            }),
          }),
        ]}
        onOpenSession={() => {}}
        onLaunch={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /release checklist/i }))
      .toHaveTextContent("Deployment is ready");

    const activity = screen.getByRole("button", { name: /dependency audit/i });
    expect(activity.querySelector(".act-session-row__summary"))
      .toHaveTextContent("Checking production licenses");

    const reason = screen.getByRole("button", { name: /migration plan/i });
    expect(reason.querySelector(".act-session-row__summary"))
      .toHaveTextContent("Choose the rollout window");
  });

  it("labels an interrupted inactive work item by its current status", () => {
    render(
      <ActivitySessionHome
        sessions={[session({
          sessionKey: "inactive",
          taskName: "Paused work",
          status: "inactive",
          lastActivity: "Inactive",
          reviewLifecycle: {
            reviewState: "interrupted_to_review",
            reviewReason: "Inactive",
            finalReport: null,
            finalDashboardRevision: null,
            dashboardRevision: 0,
            terminalReason: "abort",
            terminalAt: 10,
            acknowledgedAt: null,
            dismissedAt: null,
            lifecycleRevision: 1,
          },
        })]}
        onOpenSession={() => {}}
        onLaunch={() => {}}
      />,
    );

    const row = screen.getByRole("button", { name: /paused work/i });
    expect(row.querySelector(".act-session-row__signal"))
      .toHaveClass("act-session-row__signal--inactive");
    expect(screen.getAllByText("Inactive")).not.toHaveLength(0);
    expect(screen.queryByText("Interrupted")).not.toBeInTheDocument();
  });

  it("opens a waiting task and keeps new work available", () => {
    const onOpenSession = vi.fn();
    const onLaunch = vi.fn();
    render(
      <ActivitySessionHome
        sessions={[
          session({
            sessionKey: "waiting",
            taskName: "Release decision",
            status: "waiting",
            lastActivity: "Choose whether to ship the compatibility layer.",
          }),
          session({
            sessionKey: "running",
            taskName: "Audit dependencies",
            status: "running",
            lastActivity: "Checking production licenses.",
          }),
        ]}
        onOpenSession={onOpenSession}
        onLaunch={onLaunch}
      />,
    );

    const dashboard = screen.getByRole("main", { name: /session dashboard/i });
    expect(within(dashboard).queryByText(/select a session/i)).not.toBeInTheDocument();
    expect(within(dashboard).getByRole("button", { name: /Release decision/ })).toBeInTheDocument();
    expect(within(dashboard).getByText("Waiting for you")).toBeInTheDocument();

    fireEvent.click(within(dashboard).getByRole("button", { name: /Release decision/ }));
    expect(onOpenSession).toHaveBeenCalledWith("waiting");

    fireEvent.click(within(dashboard).getByRole("button", { name: /new leader/i }));
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("shows all recent work without a hidden cutoff and opens a session", () => {
    const onOpenSession = vi.fn();
    render(
      <ActivitySessionHome
        sessions={[
          session({ sessionKey: "one", taskName: "One", status: "running", lastActivityAt: 50 }),
          session({ sessionKey: "two", taskName: "Two", status: "idle", lastActivityAt: 40 }),
          session({ sessionKey: "three", taskName: "Three", status: "idle", lastActivityAt: 30 }),
          session({ sessionKey: "four", taskName: "Four", status: "idle", lastActivityAt: 20 }),
          session({ sessionKey: "five", taskName: "Five", status: "completed", lastActivityAt: 10 }),
          session({ sessionKey: "six", taskName: "Six", status: "completed", lastActivityAt: 5 }),
        ]}
        onOpenSession={onOpenSession}
        onLaunch={() => {}}
      />,
    );

    expect(screen.queryByText(/more in Activity/)).not.toBeInTheDocument();
    expect(screen.getByText("Five")).toBeVisible();
    expect(screen.getByText("Six")).toBeVisible();
    expect(screen.getByRole("region", { name: "Recent work" })).toBeVisible();
    expect(screen.getByText("Two")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /two/i }));
    expect(onOpenSession).toHaveBeenCalledWith("two");
  });
});
