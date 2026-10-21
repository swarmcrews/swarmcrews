import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RecentHighlights } from "./RecentHighlights.tsx";
import { libraryProject, summary } from "./test-fixture.ts";
import type { LibraryActivity } from "../../shared/project-library/index.ts";

it("starts with one conversation, expands to three, and keeps each navigation action distinct", () => {
  const project = libraryProject({ description: "Do not repeat this description" });
  const now = Date.now();
  const activity: LibraryActivity = { projectId: project.id, recent: null, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString(), leaders: Array.from({ length: 4 }, (_, i) => ({ workItemId: `work-${i}`, title: `Leader task ${i}`, at: now - i * 60000 })) };
  const onOpen = vi.fn(), onUpdates = vi.fn(), onSelect = vi.fn();
  render(<RecentHighlights projects={[project]} activity={{ alpha: activity }} summaries={{ alpha: summary({ unread: 2 }) }} now={now} {...{ onOpen, onUpdates, onSelect }} />);
  const card = screen.getByRole("article", { name: "Recent conversations for Alpha" });
  expect(within(card).getAllByRole("listitem")).toHaveLength(1);
  const expand = screen.getByRole("button", { name: "Show more conversations" });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  expect(document.getElementById(expand.getAttribute("aria-controls")!)).toContainElement(card);
  fireEvent.click(expand);
  expect(expand).toHaveAttribute("aria-expanded", "true");
  expect(within(card).getAllByRole("listitem")).toHaveLength(3);
  expect(screen.queryByText("Leader task 3")).not.toBeInTheDocument();
  expect(screen.queryByText(project.description)).not.toBeInTheDocument();
  expect(card.querySelector("footer")).toBeNull();
  const open = within(card).getByRole("button", { name: "Open Alpha from recent conversations" });
  expect(open.querySelector("button")).toBeNull();
  expect(open).toHaveClass("pl-project-action");
  expect(within(card).getByRole("button", { name: "Open leader session: Leader task 1" })).toHaveClass("pl-inline-action");
  expect(within(card).getByText("2 new")).toHaveClass("pl-new-badge");
  fireEvent.click(open); expect(onOpen).toHaveBeenCalledExactlyOnceWith(project);
  fireEvent.click(within(card).getByRole("button", { name: "Open leader session: Leader task 1" }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(project, "work-1"); expect(onOpen).toHaveBeenCalledTimes(1);
  fireEvent.click(within(card).getByRole("button", { name: "2 new updates for Alpha from highlights" }));
  expect(onUpdates).toHaveBeenCalledExactlyOnceWith(project); expect(onSelect).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Show fewer conversations" }));
  expect(within(card).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Open leader session: Leader task 1" })).not.toBeInTheDocument();
});

it("does not fabricate leader sessions from a context change or expose stale new counts", () => {
  const project = libraryProject(), now = Date.now();
  const props = { projects: [project], summaries: { alpha: summary({ unread: 2, expiresAt: "2000-01-01" }) }, now, onOpen: vi.fn(), onUpdates: vi.fn(), onSelect: vi.fn() };
  const activity: LibraryActivity = { projectId: "alpha", recent: null, leaders: [], checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString() };
  const view = render(<RecentHighlights {...props} activity={{ alpha: activity }} />);
  expect(screen.queryByRole("region", { name: "Recent conversations" })).not.toBeInTheDocument();
  view.rerender(<RecentHighlights {...props} activity={{ alpha: { ...activity, leaders: [{ workItemId: "work", title: "Actual leader", at: now }] } }} />);
  expect(screen.getByRole("button", { name: "Open leader session: Actual leader" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Show more conversations" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /new updates/ })).not.toBeInTheDocument();
});
