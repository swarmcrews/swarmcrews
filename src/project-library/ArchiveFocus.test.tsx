import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, libraryProject, summary } from "./test-fixture.ts";

afterEach(() => { vi.restoreAllMocks(); clearAuthToken(); sessionStorage.clear(); });
const switchView = (name: string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Project views" })).getByRole("button", { name }));

it("defaults Archive to list and remembers Focus and Archive layouts independently", async () => {
  libraryBoundary({ projects: [libraryProject({ focusOrder: 0 }), libraryProject({ id: "old", name: "Old", archived: true })] });
  const props = { onOpen: vi.fn() }; const view = render(<LibraryWorkspace {...props} />);
  await screen.findByRole("button", { name: "Open Alpha" });
  switchView("Archived");
  expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Grid" }));
  switchView("Focus desk");
  expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "List" }));
  switchView("Archived");
  expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
  view.unmount(); render(<LibraryWorkspace {...props} />);
  await screen.findByRole("button", { name: "View details for Old" });
  expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
  switchView("Focus desk");
  expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
});

it("restores directly without opening or starting work, preserves identity, and returns focus to results", async () => {
  const b = libraryBoundary({ projects: [libraryProject({ archived: true, tags: ["keep"], description: "Keep history" })] });
  const onOpen = vi.fn(); render(<LibraryWorkspace onOpen={onOpen} />);
  await screen.findByRole("button", { name: "View archived" }); switchView("Archived");
  const card = screen.getByRole("article", { name: "Alpha" });
  expect(within(card).queryByText("Archived")).not.toBeInTheDocument();
  expect(within(card).getByText("/repo/alpha")).toBeVisible();
  expect(within(card).getByText("Last opened")).toBeVisible();
  expect(within(card).getByRole("button", { name: "View details for Alpha" })).toBeVisible();
  fireEvent.click(within(card).getByRole("button", { name: "Restore Alpha to Library" }));
  await screen.findByText(/Restored.*Alpha.*to Library/);
  expect(b.data.projects[0]).toMatchObject({ archived: false, focusOrder: null, tags: ["keep"], description: "Keep history" });
  expect(b.requests.find(r => r.url.endsWith("/restore"))?.body).toEqual({ expectedRevision: 0 });
  expect(onOpen).not.toHaveBeenCalled();
  expect(document.querySelector(".pl-results-toolbar")).toHaveFocus();
});

it("retains the archived record on restore conflict and offers a guarded retry", async () => {
  const b = libraryBoundary({ projects: [libraryProject({ archived: true })] });
  render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "View archived" }); switchView("Archived");
  b.failNext("/restore", "REVISION_CONFLICT", 409);
  fireEvent.click(screen.getByRole("button", { name: "Restore Alpha to Library" }));
  await screen.findByText(/REVISION_CONFLICT/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Restore Alpha to Library" })).toBeEnabled());
  expect(b.data.projects[0]!.archived).toBe(true);
  expect(screen.queryByText(/Restored.*Alpha/)).not.toBeInTheDocument();
});

it("offers top and bottom pagination, resets on filtering, and groups archive sorting away from search", async () => {
  libraryBoundary({ projects: Array.from({ length: 25 }, (_, i) => libraryProject({ id: `old-${i}`, name: `Old ${i}`, archived: true })) });
  render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "View archived" }); switchView("Archived");
  const top = screen.getByRole("navigation", { name: "Project pages (top)" });
  const bottom = screen.getByRole("navigation", { name: "Project pages (bottom)" });
  expect(top).toHaveTextContent("1–24 of 25");
  expect(screen.getByLabelText("Sort projects").closest(".pl-filters")).toBeNull();
  fireEvent.click(within(bottom).getByRole("button", { name: "Next projects" }));
  expect(top).toHaveTextContent("25–25 of 25");
  expect(document.querySelector(".pl-results-toolbar")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "Old 0" } });
  expect(screen.queryByRole("navigation", { name: "Project pages (top)" })).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Old 0" })).toBeVisible();
});

it("keeps attention and waiting visible on Focus even with no unread updates", async () => {
  const b = libraryBoundary({ projects: [libraryProject({ focusOrder: 0 })] });
  b.setSummaries([summary({ running: false, state: "attention", attention: { total: 1, decision: 1, review: 0, conflict: 0 } })]);
  render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "Needs attention" }); switchView("Focus desk");
  expect(screen.getByRole("button", { name: "Needs attention" })).toHaveTextContent("1 decision");
  b.setSummaries([summary({ running: false, state: "running", activeWorkItems: 1 })]);
  fireEvent.click(screen.getByLabelText("Library tools"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh Library" }));
  expect(await screen.findByRole("button", { name: "Waiting" })).toBeVisible();
});

it("disables restore while pending and does not submit a duplicate mutation", async () => {
  const b = libraryBoundary({ projects: [libraryProject({ archived: true })] });
  const original = b.fetch.getMockImplementation()!;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  b.fetch.mockImplementation(async (...args) => {
    if (String(args[0]).endsWith("/restore")) await pending;
    return original(...args);
  });
  render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "View archived" }); switchView("Archived");
  const restore = screen.getByRole("button", { name: "Restore Alpha to Library" });
  fireEvent.click(restore); expect(restore).toBeDisabled(); fireEvent.click(restore);
  await waitFor(() => expect(b.fetch.mock.calls.filter(([url]) => String(url).endsWith("/restore"))).toHaveLength(1));
  release();
  await screen.findByText(/Restored.*Alpha.*to Library/);
});
