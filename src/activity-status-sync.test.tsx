import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialWorkItemLifecycle, type WorkItemLifecycle, type WorkItemWaitKind } from "../shared/work-item-lifecycle.ts";
import type { WorkItemSnapshot } from "../shared/work-item-contracts.ts";
import { ActivitySessionHome, sessionRelevanceLabel } from "./ActivitySessionHome.tsx";
import { activityStatusLabel, activityStatusTone, attentionAction, attentionKind, groupSessionsForTriage,
  isActivityReady, isActivityWorking, needsAttention } from "./mobile/mobile-selectors.ts";
import { mergeCanonicalActivity, mergeWorkItemSnapshot } from "./use-work-items.ts";
import { useSessionActivity } from "./use-session-activity.ts";
import type { ServerMessage, SocketSubscribe } from "./use-socket.ts";

function item(lifecycle: Partial<WorkItemLifecycle>, waitKind: WorkItemWaitKind | null = null): WorkItemSnapshot {
  return { id: "a", projectId: "p", projectPath: "/repo", title: "Current work",
    lifecycle: { ...initialWorkItemLifecycle(), ...lifecycle }, waitKind,
    currentRunKey: "run-a", iteration: 1, createdAt: 1, updatedAt: 10, lastTransitionAt: 10 };
}

describe("canonical Activity status convergence", () => {
  it.each([
    { lifecycle: { runtimeState: "starting" }, label: "Starting", attention: false, working: true },
    { lifecycle: { runtimeState: "waiting" }, waitKind: "other", label: "Waiting", attention: false, working: true },
    { lifecycle: { runtimeState: "waiting" }, waitKind: "decision", label: "Decision needed", attention: true, working: false },
    { lifecycle: { runtimeState: "waiting" }, waitKind: "file_conflict", label: "Waiting for files", attention: true, working: false },
    { lifecycle: { runtimeState: "inactive", outcome: "completed" }, label: "Ready for review", attention: true, working: false },
    { lifecycle: { runtimeState: "inactive", outcome: "completed", resolution: "reviewed" }, label: "Reviewed", attention: false, working: false },
    { lifecycle: { runtimeState: "inactive", outcome: "completed", changeMode: "worktree", integrationState: "worktree_integrating" }, label: "Integrating", attention: false, working: true },
    { lifecycle: { runtimeState: "inactive", outcome: "error" }, label: "Error", attention: true, working: false },
    { lifecycle: { runtimeState: "draft" }, label: "Draft", attention: false, working: false },
  ] satisfies { lifecycle: Partial<WorkItemLifecycle>; waitKind?: WorkItemWaitKind; label: string; attention: boolean; working: boolean }[])(
    "keeps $label consistent across labels, filters, and triage", ({ lifecycle, waitKind, label, attention, working }) => {
      const [row] = mergeCanonicalActivity([], [item(lifecycle, waitKind)]);
      expect(activityStatusLabel(row!)).toBe(label);
      expect(sessionRelevanceLabel(row!)).toBe(label);
      expect(needsAttention(row!)).toBe(attention);
      expect(isActivityWorking(row!)).toBe(working);
      expect(isActivityReady(row!)).toBe(!attention && !working);
      const triage = groupSessionsForTriage([row!]);
      expect(triage.needsYou).toHaveLength(attention ? 1 : 0);
      if (working) expect(triage.sections[0]?.id).toBe("active");
    },
  );

  it("shows automatic waits without claiming that the user must respond", () => {
    const rows = mergeCanonicalActivity([], [item({ runtimeState: "waiting" }, "other")]);
    render(<ActivitySessionHome sessions={rows} onOpenSession={() => {}} onLaunch={() => {}} />);
    expect(screen.getByText("No decisions or reviews waiting on you.")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for you")).toBeNull();
  });

  it("keeps review and file waits distinct from requests to reply", () => {
    const [completed] = mergeCanonicalActivity([], [item({ runtimeState: "inactive", outcome: "completed" })]);
    expect(attentionKind(completed!)).toBe("changes");
    expect(activityStatusTone(completed!)).toBe("completed");
    expect(attentionAction(completed!)).toBe("Read");
    const [files] = mergeCanonicalActivity([], [item({ runtimeState: "waiting" }, "file_conflict")]);
    expect(attentionAction(files!)).toBe("View");
  });

  it("preserves canonical status across a stale snapshot and newer live activity", () => {
    const waiting = item({ runtimeState: "waiting", lifecycleRevision: 3 }, "other");
    const completed = item({ runtimeState: "inactive", outcome: "completed", lifecycleRevision: 4 });
    const [row] = mergeCanonicalActivity([{ sessionKey: "run-a", sessionId: null,
      cwd: "/repo", status: "running", lastActivityAt: 50, pendingAttention: true }],
    [mergeWorkItemSnapshot(completed, waiting)]);
    expect(activityStatusLabel(row!)).toBe("Ready for review");
    expect(row?.lastActivityAt).toBe(50);
  });

  it("does not let cached activity make a refreshed session look older", () => {
    let emit: (message: ServerMessage) => void = () => {};
    const subscribe = ((_topic: unknown, listener: typeof emit) => {
      emit = listener;
      return () => {};
    }) as SocketSubscribe;
    const { result } = renderHook(() => useSessionActivity(subscribe));
    act(() => {
      emit({ type: "sdk_event", sessionKey: "run-a", timestamp: 20,
        event: { kind: "text", role: "assistant", text: "Earlier response" } });
      emit({ type: "session_list", sessions: [{ sessionKey: "run-a", sessionId: null,
        cwd: "/repo", status: "running", lastActivityAt: 50 }] });
    });
    expect(result.current.mobileSessions[0]?.lastActivityAt).toBe(50);
  });
});
