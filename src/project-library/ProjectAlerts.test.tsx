import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, summary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
afterEach(() => { sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });

const update = (id: string, unread: boolean) => ({ id, revision: 1, projectId: "alpha", workItemId: id, kind: "work_item", text: id, at: Date.now(), unread, destination: { view: "activity", workItemId: id } });

describe("project alert destinations", () => {
  it("shows only new updates, not the full attention list, and offers Activity for other actions", async () => {
    const b = libraryBoundary();
    b.setSummaries([summary({ state: "attention", unread: 1, attention: { total: 2, decision: 1, review: 1, conflict: 0 } })]);
    b.setEvents([update("New result", true), update("Previously read", false)]);
    const onOpen = vi.fn(); render(<LibraryWorkspace onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole("button", { name: "1 new updates for Alpha" }));
    const dialog = await screen.findByRole("dialog", { name: "Updates · Alpha" });
    expect(await within(dialog).findByText("New result")).toBeVisible();
    const updates = within(dialog).getByRole("region", { name: "Recorded updates" });
    expect(dialog.querySelector(".pl-dialog-body")?.firstElementChild).toBe(updates);
    expect(within(dialog).queryByText("Previously read")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("region", { name: "Work needing attention" })).not.toBeInTheDocument();
    expect(b.requests.some(r => r.url.includes("/attention?"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Open Activity" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }), { view: "activity" });
    expect(b.requests.some(r => r.url.includes("/acknowledge"))).toBe(false);
  });

  it("stays on unread when the New count is stale instead of falling back to old updates", async () => {
    const b = libraryBoundary(); b.setSummaries([summary({ state: "new", unread: 1 })]);
    b.setEvents([update("Previously read", false)]);
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "New updates" }));
    const dialog = await screen.findByRole("dialog", { name: "Updates · Alpha" });
    expect(await within(dialog).findByText("You’re all caught up")).toBeVisible();
    expect(within(dialog).queryByText("Previously read")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Unread/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens main Activity from Running even when the remembered destination is Canvas", async () => {
    const b = libraryBoundary(); b.setSummaries([summary({ state: "running", activeLeaders: 1 })]);
    sessionStorage.setItem("swarmcrews:project-destination:alpha", JSON.stringify({ view: "canvas", workItemId: "old-work" }));
    const onOpen = vi.fn(); render(<LibraryWorkspace onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole("button", { name: "Running" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }), { view: "activity" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(b.requests.some(r => /events|attention/.test(r.url))).toBe(false);
  });
});
