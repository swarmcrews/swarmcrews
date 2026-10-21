import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { defaultFilters } from "./model.ts";
import { libraryBoundary, libraryProject, summary } from "./test-fixture.ts";

beforeEach(() => sessionStorage.clear());
afterEach(() => { sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });
it("reports waiting work separately from unread updates on mobile while showing only executing leaders as Running", async () => {
  const boundary = libraryBoundary({ projects: [libraryProject(), libraryProject({ id: "beta", name: "Beta" })] });
  boundary.setSummaries([
    summary({ state: "attention", activeLeaders: 3, runningLeaders: 1, running: true, unread: 1 }),
    summary({ projectId: "beta", state: "attention", activeLeaders: 2, activeWorkItems: 3, runningLeaders: 0, running: false, unread: 2 }),
  ]);
  render(<LibraryWorkspace compact onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "Waiting" });
  const running = within(screen.getByRole("article", { name: "Alpha" }));
  expect(running.getByRole("button", { name: "Running" })).toHaveAccessibleDescription("1 active leader");
  const waiting = within(screen.getByRole("article", { name: "Beta" }));
  expect(waiting.queryByRole("button", { name: "Running" })).not.toBeInTheDocument();
  expect(waiting.getByRole("button", { name: "Waiting" })).toBeVisible();
  expect(waiting.getByRole("button", { name: "2 new updates for Beta" })).toBeVisible();
});

it("signals persisted filters and unread updates without expanding the mobile header", async () => {
  sessionStorage.setItem("swarmcrews:library-view", JSON.stringify({ ...defaultFilters, tag: "client", collection: "clients" }));
  const boundary = libraryBoundary({
    projects: [libraryProject({ tags: ["client"], collectionIds: ["clients"], focusOrder: 0 })],
    collections: [{ id: "clients", name: "Clients" }],
  });
  boundary.setSummaries([summary({ unread: 3 })]);
  render(<LibraryWorkspace compact onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "Open Alpha" });
  const toggle = screen.getByRole("button", { name: "Filters and tools" });
  expect(toggle).toHaveTextContent("Filters (2)");
  expect(toggle).toHaveAccessibleDescription("2 active filters. 3 unread updates. Sorting and project tools.");
  const updates = screen.getByRole("region", { name: "Unread updates" });
  expect(updates).toBeVisible();
  expect(updates.closest(".pl-mobile-panel")).toBeNull();
  expect(screen.queryByRole("region", { name: "Pinned projects" })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByRole("region", { name: "Unread updates" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Pinned projects" })).toBeVisible();
  expect(screen.getByLabelText("Collection")).toHaveValue("clients");
  fireEvent.click(screen.getByRole("button", { name: "Manage collections" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  fireEvent.click(toggle);
  expect(toggle).toHaveTextContent("Filters");
  expect(toggle).not.toHaveTextContent("(2)");
  expect(toggle).toHaveAccessibleDescription("0 active filters. 3 unread updates. Sorting and project tools.");
  fireEvent.change(screen.getByLabelText("Project view"), { target: { value: "focus" } });
  expect(screen.getByRole("button", { name: "Open Alpha" })).toBeVisible();
  fireEvent.click(toggle);
  expect(screen.queryByLabelText("Sort projects")).not.toBeInTheDocument();
});

it("clears mobile unread updates through the existing confirmation with Filters collapsed", async () => {
  const boundary = libraryBoundary();
  boundary.setSummaries([summary({ state: "new", unread: 1 })]);
  render(<LibraryWorkspace compact onOpen={vi.fn()} />);
  const toggle = await screen.findByRole("button", { name: "Filters and tools" });
  const mark = await screen.findByRole("button", { name: "Mark all read" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(mark);
  const dialog = screen.getByRole("dialog", { name: "Mark all updates read?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Mark 1 read" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Unread updates" })).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("article", { name: "Alpha" }).querySelector(".pl-state, footer")).toBeNull());
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(boundary.requests.filter(r => r.url.endsWith("/acknowledge-all")).map(r => r.body)).toEqual([{ asOf: expect.any(Number) }]);
});
