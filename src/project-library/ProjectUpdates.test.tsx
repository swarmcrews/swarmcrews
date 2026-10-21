import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { boundaryResponse, libraryBoundary, summary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
afterEach(() => { sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });

const attentionSummary = (unread: number) => summary({ state: "attention", unread, attention: { total: 1, decision: 1, review: 1, conflict: 0 } });
const event = (over: Record<string, unknown> = {}) => ({ id: "event-1", revision: 1, projectId: "alpha", workItemId: "work-1", kind: "work_item" as const, text: "Result ready", at: 1_700_000_000_000, unread: true, destination: { view: "activity" as const, workItemId: "work-1" }, ...over });
const openUpdates = async (name?: string) => {
  if (name) fireEvent.click(await screen.findByRole("button", { name }));
  else {
    fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Updates" }));
  }
  return screen.findByRole("dialog", { name: "Updates · Alpha" });
};
function pagedEvents(b: ReturnType<typeof libraryBoundary>, pages: Record<string, unknown>) {
  const base = b.fetch.getMockImplementation()!;
  b.fetch.mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.includes("/events?")) return boundaryResponse(url.includes("cursor=next") ? pages["second"] : pages["first"]);
    return base(input, options);
  });
}

describe("Reviewing and clearing a project's updates", () => {
  it("clears a running project's unread action without clearing its Running status", async () => {
    const b = libraryBoundary();
    b.setSummaries([summary({ state: "running", activeLeaders: 1, unread: 1 })]);
    b.setEvents([event()]);
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    const dialog = await openUpdates("1 new updates for Alpha");
    await within(dialog).findByRole("button", { name: "Mark read: Result ready" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark all read" }));
    const card = screen.getByRole("article", { name: "Alpha" });
    await waitFor(() => expect(card.querySelector("footer")).toBeNull());
    expect(within(card).getByRole("button", { name: "Running" })).toBeVisible();
    expect(within(card).queryByRole("button", { name: "New updates" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Mark all read" })).toBeDisabled();
    expect(b.requests.filter(r => r.url.endsWith("/acknowledge-all")).map(r => r.body)).toEqual([{ asOf: 1_700_000_000_000, projectIds: ["alpha"] }]);
  });

  it("does not mark visits read; a failed per-update clear keeps it unread and a retry sends only that receipt-bound update", async () => {
    const b = libraryBoundary(); b.setSummaries([attentionSummary(2)]); b.setEvents([event()]);
    const onOpen = vi.fn(); render(<LibraryWorkspace onOpen={onOpen} />);
    const dialog = await openUpdates("2 new updates for Alpha");
    expect(await within(dialog).findAllByText("Result ready")).toHaveLength(1);
    expect(b.requests.some(r => r.url.includes("/acknowledge"))).toBe(false);
    expect(within(dialog).queryByRole("region", { name: "Work needing attention" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("1 unread");
    b.failNext("/acknowledge");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark read: Result ready" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("OFFLINE");
    expect(within(dialog).getByRole("button", { name: "Mark read: Result ready" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2 new updates for Alpha" })).toBeInTheDocument();
    b.setSummaries([attentionSummary(3)]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark read: Result ready" }));
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("All caught up"));
    await waitFor(() => expect(screen.getByRole("button", { name: "2 new updates for Alpha" })).toBeInTheDocument());
    expect(b.requests.filter(r => r.url.endsWith("/acknowledge")).map(r => r.body)).toEqual(Array(2).fill({ receipt: "signed-shown-page", events: [{ id: "event-1", revision: 1 }] }));
    expect(screen.getByRole("button", { name: "Needs attention" })).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Open work item: Result ready" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }), { view: "activity", workItemId: "work-1" });
    expect(b.requests.some(r => /approve|review$|merge/.test(r.url))).toBe(false);
  });

  it("marks everything for this project read up to the newest shown update, leaving attention untouched", async () => {
    const b = libraryBoundary(); b.setSummaries([attentionSummary(2), summary({ projectId: "beta", unread: 4 })]); b.setEvents([event({ at: 1_700_000_005_000 }), event({ id: "event-2", at: 1_700_000_001_000, text: "Earlier" })]);
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    const dialog = await openUpdates("2 new updates for Alpha");
    expect(await within(dialog).findByText("Earlier")).toBeVisible();
    const all = within(dialog).getByRole("button", { name: "Mark all read" });
    fireEvent.click(all);
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("All caught up"));
    expect(b.requests.filter(r => r.url.endsWith("/acknowledge-all")).map(r => r.body)).toEqual([{ asOf: 1_700_000_005_000, projectIds: ["alpha"] }]);
    expect(all).toBeDisabled();
    expect(within(dialog).getByText("You’re all caught up")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: /^Mark read:/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("article", { name: "Alpha" }).querySelector(".pl-state, footer")).toBeNull());
    expect(within(dialog).getByText("Needs attention").closest(".pl-stat")).toHaveTextContent("1");
    expect(b.requests.some(r => /approve|review$|merge/.test(r.url))).toBe(false);
  });

  it("keeps updates that arrive while the dialog is open unread and shows them after clearing", async () => {
    const b = libraryBoundary(); b.setSummaries([attentionSummary(1)]); b.setEvents([event({ at: 1_700_000_000_000 })]);
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    const dialog = await openUpdates("1 new updates for Alpha");
    await within(dialog).findAllByText("Result ready");
    b.setEvents([event({ at: 1_700_000_000_000 }), event({ id: "event-late", text: "Arrived meanwhile", at: Date.now() + 60_000 })]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark all read" }));
    expect(await within(dialog).findByRole("button", { name: "Mark read: Arrived meanwhile" })).toBeVisible();
    expect(within(dialog).getByRole("status")).toHaveTextContent("1 unread");
    expect(within(dialog).queryByRole("button", { name: "Mark read: Result ready" })).not.toBeInTheDocument();
    expect(b.requests.find(r => r.url.endsWith("/acknowledge-all"))!.body).toEqual({ asOf: 1_700_000_000_000, projectIds: ["alpha"] });
  });

  it("loads details only when opened and retries unavailable event data without implying zero", async () => {
    const b = libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    expect(b.requests.some(r => /events|attention/.test(r.url))).toBe(false);
    b.failNext("/events?");
    const dialog = await openUpdates();
    expect(await within(dialog).findByRole("button", { name: "Reload updates" })).toBeEnabled();
    expect(within(dialog).queryByText("No recorded updates")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Mark all read" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reload updates" }));
    expect(await within(dialog).findAllByText("Result ready")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Mark all read" })).toBeEnabled();
  });

  it("appends older pages, filters unread, and opens context without marking it read", async () => {
    const b = libraryBoundary();
    pagedEvents(b, {
      first: { events: [event({ id: "first", revision: 2, workItemId: null, kind: "context", text: "Context changed", destination: { view: "context" } })], receipt: "page-receipt", nextCursor: "next" },
      second: { events: [event({ id: "second", text: "Older work", unread: false })], receipt: "second-receipt", nextCursor: null },
    });
    const onOpen = vi.fn(); render(<LibraryWorkspace onOpen={onOpen} />);
    const dialog = await openUpdates();
    expect(await within(dialog).findByText("Context changed")).toBeVisible();
    expect(within(dialog).getByRole("status")).toHaveTextContent("1+ unread");
    fireEvent.click(within(dialog).getByRole("button", { name: "Load older updates" }));
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: "Load older updates" })).not.toBeInTheDocument());
    expect(within(dialog).queryByText("Older work")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    expect(within(dialog).getByText("Older work")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open context: Context changed" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }), { view: "context" });
    expect(b.requests.some(r => r.url.includes("/acknowledge"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark read: Context changed" }));
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("All caught up"));
    expect(b.requests.find(r => r.url.endsWith("/acknowledge"))!.body).toEqual({ receipt: "page-receipt", events: [{ id: "first", revision: 2 }] });
  });

  it("explains empty, caught-up and unread-free states and lets you switch to everything", async () => {
    const b = libraryBoundary(); b.setEvents([]);
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    let dialog = await openUpdates();
    expect(await within(dialog).findByText("No recorded updates")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Mark all read" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    b.setEvents([event({ unread: false })]);
    dialog = await openUpdates();
    const recorded = within(dialog).getByRole("region", { name: "Recorded updates" });
    expect(await within(recorded).findByText("You’re all caught up")).toBeVisible();
    expect(within(recorded).getByRole("button", { name: /^Unread/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(recorded).queryByRole("button", { name: /^Mark read:/ })).not.toBeInTheDocument();
    fireEvent.click(within(recorded).getByRole("button", { name: "Show all updates" }));
    expect(within(recorded).getByRole("button", { name: "Open work item: Result ready" })).toBeVisible();
  });
});
