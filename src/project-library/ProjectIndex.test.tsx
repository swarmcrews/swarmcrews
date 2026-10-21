import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectIndexRow } from "./ProjectIndex.tsx";
import { libraryProject, summary } from "./test-fixture.ts";

it("keeps project open, live activity, unread and organization independent", () => {
  const onOpen = vi.fn(), onActivity = vi.fn(), onUpdates = vi.fn(), onDetails = vi.fn();
  render(<ProjectIndexRow project={libraryProject()} summary={summary({ state: "running", running: true, runningLeaders: 1, activeCrew: 3, unread: 2 })} now={Date.now()} {...{ onOpen, onActivity, onUpdates, onDetails }} />);
  const activity = screen.getByRole("button", { name: "Running" });
  expect(activity).toHaveClass("pl-inline-action");
  expect(screen.getByRole("button", { name: "Open Alpha" })).toHaveClass("pl-project-action");
  expect(screen.getByText("2 new")).toHaveClass("pl-new-badge");
  expect(activity).toHaveAccessibleDescription("1 active leader · 3 active crew");
  expect(activity.querySelector(".leader-status-icon")).toHaveAttribute("data-state", "active");
  fireEvent.click(activity); expect(onActivity).toHaveBeenCalledOnce(); expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "2 new updates for Alpha" })); expect(onUpdates).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Details and organization for Alpha" })); expect(onDetails).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Open Alpha" })); expect(onOpen).toHaveBeenCalledOnce();
});

it("does not promote stale or contradictory counters to quiet or live status", () => {
  const props = { project: libraryProject(), now: Date.now(), onOpen: vi.fn(), onActivity: vi.fn(), onUpdates: vi.fn(), onDetails: vi.fn() };
  const view = render(<ProjectIndexRow {...props} summary={summary({ state: "running", running: true, activeLeaders: 2, unread: 4, expiresAt: "2000-01-01" })} />);
  expect(screen.getByText("Status unavailable")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Running" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /new updates/ })).not.toBeInTheDocument();
  view.rerender(<ProjectIndexRow {...props} summary={summary({ state: "up_to_date", activeWorkItems: 2 })} />);
  expect(screen.getByText("Status unavailable")).toBeVisible();
  view.rerender(<ProjectIndexRow {...props} summary={summary()} />);
  expect(screen.getByText("No active work")).toBeVisible();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});

it("shows waiting separately from execution and preserves full duplicate-name paths", () => {
  render(<ProjectIndexRow project={libraryProject()} pathHint="client/alpha" summary={summary({ state: "running", running: false, activeLeaders: 2, unread: 0 })} now={Date.now()} onOpen={vi.fn()} onActivity={vi.fn()} onUpdates={vi.fn()} onDetails={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Waiting" })).toBeVisible();
  expect(screen.getByText("client/alpha")).toHaveAttribute("title", "/repo/alpha");
});

it("makes attention actionable with a visible reason, icon and directional affordance", () => {
  const onActivity = vi.fn(), onOpen = vi.fn();
  render(<ProjectIndexRow project={libraryProject()} summary={summary({ state: "attention", attention: { total: 2, decision: 1, review: 1, conflict: 0 } })} now={Date.now()} onOpen={onOpen} onActivity={onActivity} onUpdates={vi.fn()} onDetails={vi.fn()} />);
  const action = screen.getByRole("button", { name: "Needs attention" });
  expect(action).toHaveTextContent("1 decision · 1 review");
  expect(action).toHaveAccessibleDescription("1 decision · 1 review");
  expect(action.querySelector(".pl-attention-icon")).toHaveAttribute("aria-hidden", "true");
  expect(action.querySelector(".pl-status-arrow")).toHaveAttribute("aria-hidden", "true");
  fireEvent.click(action); expect(onActivity).toHaveBeenCalledOnce(); expect(onOpen).not.toHaveBeenCalled();
});
