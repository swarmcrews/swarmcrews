import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySessionHome } from "./ActivitySessionHome.tsx";
import { captureBriefing } from "./activity-return-briefing.ts";
import { briefingStorageKey, useActivityReturnBriefing } from "./use-activity-return-briefing.ts";
import type { MobileSessionInfo } from "./mobile/mobile-selectors.ts";

const now = Date.now();
function session(overrides: Partial<MobileSessionInfo> = {}): MobileSessionInfo {
  return { sessionKey: "s", sessionId: null, status: "completed", cwd: "/repo",
    taskName: "Retry fix", lastActivityAt: now - 1000, ...overrides };
}
function Home({ sessions, onOpenSession = () => {}, onLaunch = () => {} }: {
  sessions: MobileSessionInfo[];
  onOpenSession?: (key: string) => void;
  onLaunch?: () => void;
}) {
  const briefing = useActivityReturnBriefing(sessions, "home-test", true, true);
  return <ActivitySessionHome briefing={briefing} onOpenSession={onOpenSession} onLaunch={onLaunch} />;
}
const seed = (sessions: MobileSessionInfo[]) => localStorage.setItem(briefingStorageKey("home-test"),
  JSON.stringify(captureBriefing(sessions, now - 2000)));

beforeEach(() => localStorage.clear());

describe("Activity return briefing", () => {
  it("places the current canvas after the heading, independently of briefing loading", () => {
    render(<ActivitySessionHome briefing={null} onOpenSession={() => {}} onLaunch={() => {}}
      canvasPreview={<section aria-label="Current canvas">Workspace preview</section>} />);
    const heading = screen.getByRole("heading", { name: "Since your last visit" });
    const preview = screen.getByRole("region", { name: "Current canvas" });
    const loading = screen.getByText("Loading your briefing…");
    expect(heading.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.compareDocumentPosition(loading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("replaces the duplicate session inventory with meaningful changes and source links", () => {
    const open = vi.fn();
    const launch = vi.fn();
    render(<Home sessions={[
      session({ sessionKey: "live", taskName: "Live task", status: "running" }),
      session({ sessionKey: "decision", taskName: "Migration strategy", status: "waiting", lastActivity: "Choose a rollout window" }),
      session({ sessionKey: "done", lastActivity: "Retry handling implemented" }),
      session({ sessionKey: "error", taskName: "Interrupted investigation", status: "error", lastActivity: "Connection failed" }),
    ]} onOpenSession={open} onLaunch={launch} />);
    expect(screen.getByRole("heading", { name: "Since your last visit" })).toBeVisible();
    expect(screen.queryByText("Live task")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Active tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent work" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Needs your input" })).getByText("Migration strategy")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "What moved forward" })).getByText("Retry fix")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Worth picking back up" })).getByText("Connection failed", { exact: false })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Migration strategy/ }));
    expect(open).toHaveBeenCalledWith("decision");
    fireEvent.click(screen.getByRole("button", { name: "New leader" }));
    expect(launch).toHaveBeenCalledOnce();
  });

  it("puts a group-specific next action before the excerpt", () => {
    const open = vi.fn();
    render(<Home sessions={[
      session({ sessionKey: "request", status: "waiting", taskName: "Choose release window", lastActivity: "Please choose a rollout window" }),
      session({ sessionKey: "outcome", lastActivity: "**Retry handling** implemented" }),
      session({ sessionKey: "interruption", status: "error", taskName: "Interrupted run", lastActivity: "Connection failed" }),
    ]} onOpenSession={open} />);
    const requestRoute = screen.getByRole("button", { name: "Review request: Choose release window" });
    const route = screen.getByRole("button", { name: "View result: Retry fix" });
    const interruptionRoute = screen.getByRole("button", { name: "Resume work: Interrupted run" });
    const action = within(route).getByText("View result");
    const excerpt = within(route).getByText("Recorded context: Retry handling implemented");
    expect(action.compareDocumentPosition(excerpt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(requestRoute).getByText("Review request")).toBeVisible();
    expect(within(interruptionRoute).getByText("Resume work")).toBeVisible();
    fireEvent.click(route);
    expect(open).toHaveBeenCalledWith("outcome");
  });

  it("shows an explicit first-visit window rather than claiming prior history", () => {
    render(<Home sessions={[session()]} />);
    expect(screen.getByText(/First visit on this browser/)).toBeVisible();
    expect(screen.getByLabelText("Look back")).toHaveDisplayValue("Past 24 hours");
    expect(document.querySelectorAll("time[datetime]")).toHaveLength(2);
  });

  it("has a quiet state when no meaningful work changed", () => {
    seed([session()]);
    render(<Home sessions={[session()]} />);
    expect(screen.getByText("Nothing new since your last visit.")).toBeVisible();
    expect(screen.getByText("Your work is available in the sidebar.")).toBeVisible();
    expect(screen.queryByText("Retry fix")).not.toBeInTheDocument();
  });

  it("keeps new live outcomes behind an explicit refresh", () => {
    seed([session({ status: "running" })]);
    const { rerender } = render(<Home sessions={[session({ status: "running" })]} />);
    rerender(<Home sessions={[session({ lastActivity: "Patch finished" })]} />);
    expect(screen.queryByText("Retry fix")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 new update · Refresh briefing/ }));
    expect(screen.getByText("Retry fix")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Refresh briefing/ })).not.toBeInTheDocument();
  });

  it("removes resolved requests only on refresh", () => {
    const waiting = session({ status: "waiting", taskName: "Decision" });
    const { rerender } = render(<Home sessions={[waiting]} />);
    rerender(<Home sessions={[{ ...waiting, status: "running" }]} />);
    expect(screen.getByText("Decision")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Refresh briefing/ }));
    expect(screen.queryByText("Decision")).not.toBeInTheDocument();
  });

  it("offers a seven-day lookback without bringing back active-task inventory", () => {
    const old = session({ lastActivityAt: now - 2 * 86400000 });
    seed([old]);
    render(<Home sessions={[old]} />);
    expect(screen.queryByText("Retry fix")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Look back"), { target: { value: "week" } });
    expect(screen.getByText("Retry fix")).toBeVisible();
    expect(screen.getByText(/not a complete event history/)).toBeVisible();
  });

  it("does not claim verification or integration based on an agent report", () => {
    render(<Home sessions={[session({ lastActivity: "All tests passed and merged" })]} />);
    expect(screen.getByText("Reported complete")).toBeVisible();
    expect(screen.getByText("Recorded context: All tests passed and merged")).toBeVisible();
    expect(screen.getByText("Recorded outcomes, not proof of verification or integration.")).toBeVisible();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("keeps structured reports out of the preview and suppresses title echoes", () => {
    render(<Home sessions={[
      session({ lastActivity: JSON.stringify({ summary: "Done", nextSteps: ["Review"] }) }),
      session({ sessionKey: "echo", taskName: "Release checklist", lastActivity: " release CHECKLIST " }),
    ]} />);
    expect(screen.getByText(/Agent report available. Open session to view details./)).toBeVisible();
    expect(screen.queryByText(/Recorded context: release CHECKLIST/)).not.toBeInTheDocument();
  });

  it("keeps frozen content but follows the current run of a durable work item", () => {
    const open = vi.fn();
    const completed = session({ sessionKey: "old", workItemId: "w" });
    const { rerender } = render(<Home sessions={[completed]} onOpenSession={open} />);
    rerender(<Home sessions={[{ ...completed, sessionKey: "new", status: "running" }]} onOpenSession={open} />);
    fireEvent.click(screen.getByRole("button", { name: /Retry fix/ }));
    expect(open).toHaveBeenCalledWith("new");
  });

  it("marks unavailable source links instead of silently doing nothing", () => {
    const { rerender } = render(<Home sessions={[session()]} />);
    rerender(<Home sessions={[]} />);
    expect(screen.getByRole("button", { name: /Retry fix/ })).toBeDisabled();
    expect(screen.getByText(/Source no longer in loaded activity/)).toBeVisible();
  });
});
