import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, libraryProject, summary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
afterEach(() => { sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });

const twoProjects = () => {
  const b = libraryBoundary({ projects: [libraryProject(), libraryProject({ id: "beta", workspaceId: "beta", name: "Beta", path: "/repo/beta" })] });
  b.setSummaries([summary({ projectId: "alpha", unread: 3 }), summary({ projectId: "beta", unread: 2 })]);
  return b;
};

describe("Clearing update notifications for every project from the Library", () => {
  it("summarizes Library-wide unread updates and stays out of the way when there are none", async () => {
    const b = twoProjects(); const view = render(<LibraryWorkspace onOpen={vi.fn()} />);
    const bar = await screen.findByRole("region", { name: "Unread updates" });
    expect(bar).toHaveTextContent("5 unread updates across 2 projects");
    expect(within(bar).getByRole("button", { name: "Mark all read" })).toBeEnabled();
    view.unmount(); b.setSummaries([summary({ projectId: "alpha" }), summary({ projectId: "beta" })]);
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    await waitFor(() => expect(b.requests.some(r => r.url.endsWith("/unread"))).toBe(true));
    expect(screen.queryByRole("region", { name: "Unread updates" })).not.toBeInTheDocument();
  });

  it("hides the bar rather than implying zero when the unread total is unavailable", async () => {
    const b = twoProjects(); b.failNext("/unread");
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    await waitFor(() => expect(b.requests.some(r => r.url.endsWith("/unread"))).toBe(true));
    expect(screen.queryByRole("region", { name: "Unread updates" })).not.toBeInTheDocument();
  });

  it("confirms before clearing, can be cancelled, and sends no project scope", async () => {
    const b = twoProjects(); render(<LibraryWorkspace onOpen={vi.fn()} />);
    fireEvent.click(within(await screen.findByRole("region", { name: "Unread updates" })).getByRole("button", { name: "Mark all read" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark all updates read?" });
    expect(dialog).toHaveTextContent("5 unread updates across 2 projects will be marked read.");
    expect(dialog).toHaveTextContent("Decisions, reviews and conflicts are not resolved");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(b.requests.some(r => r.url.endsWith("/acknowledge-all"))).toBe(false);
    fireEvent.click(within(screen.getByRole("region", { name: "Unread updates" })).getByRole("button", { name: "Mark all read" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Mark all updates read?" })).getByRole("button", { name: "Mark 5 read" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const [request] = b.requests.filter(r => r.url.endsWith("/acknowledge-all"));
    expect(request!.body).toEqual({ asOf: expect.any(Number) });
    expect(await screen.findByText("Marked 5 updates read. Work and files are unchanged.")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Unread updates" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /new updates? for/ })).not.toBeInTheDocument();
    expect(b.requests.some(r => /approve|review$|merge|archive/.test(r.url))).toBe(false);
  });

  it("keeps the dialog and the count when the clear fails, then succeeds on retry", async () => {
    const b = twoProjects(); render(<LibraryWorkspace onOpen={vi.fn()} />);
    fireEvent.click(within(await screen.findByRole("region", { name: "Unread updates" })).getByRole("button", { name: "Mark all read" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark all updates read?" });
    b.failNext("/acknowledge-all");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark 5 read" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("OFFLINE");
    expect(screen.getByRole("region", { name: "Unread updates", hidden: true })).toHaveTextContent("5 unread updates");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark 5 read" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(b.requests.filter(r => r.url.endsWith("/acknowledge-all"))).toHaveLength(2);
  });

  it("uses singular copy for one update in one project", async () => {
    const b = libraryBoundary(); b.setSummaries([summary({ unread: 1 })]);
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    expect(await screen.findByRole("region", { name: "Unread updates" })).toHaveTextContent("1 unread update across 1 project");
  });
});
