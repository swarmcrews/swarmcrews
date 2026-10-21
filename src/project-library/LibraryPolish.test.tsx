import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { LibraryNotice } from "./LibraryNotice.tsx";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { useRegistrationOpen } from "./use-registration-open.ts";
import { libraryBoundary, libraryProject } from "./test-fixture.ts";

const trio = () => [libraryProject(), libraryProject({ id: "beta", name: "Beta", path: "/repo/beta", focusOrder: 0 }), libraryProject({ id: "old", name: "Old", path: "/repo/old", archived: true })];
const nav = () => screen.getByRole("navigation", { name: "Project views" });

describe("Library page states and affordances", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => { sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });

  it("shows per-view counts once loaded without changing control names, and explains each view on demand", async () => {
    libraryBoundary({ projects: trio() });
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    expect(within(nav()).queryByText("2")).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "Open Alpha" });
    for (const [name, count] of [["Library", "2"], ["Focus desk", "1"], ["Archived", "1"]] as const) {
      const tab = within(nav()).getByRole("button", { name });
      expect(tab).toHaveTextContent(`${name}${count}`);
      expect(tab.querySelector(".pl-count")).toHaveAttribute("aria-hidden", "true");
    }
    fireEvent.click(screen.getByLabelText("Library tools"));
    expect(screen.getByText(/Every repository you have registered/)).toBeVisible();
    fireEvent.click(within(nav()).getByRole("button", { name: "Focus desk" }));
    expect(screen.getByText(/in the order you chose/)).toBeVisible();
    fireEvent.click(within(nav()).getByRole("button", { name: "Archived" }));
    expect(screen.getByText(/restore any time/)).toBeVisible();
  });

  it("renders a hidden skeleton with the loading status, then removes it", async () => {
    libraryBoundary();
    const { container } = render(<LibraryWorkspace onOpen={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading Library…");
    expect(container.querySelector(".pl-index-skeleton")).toHaveAttribute("aria-hidden", "true");
    await screen.findByRole("button", { name: "Open Alpha" });
    expect(container.querySelector(".pl-index-skeleton")).not.toBeInTheDocument();
  });

  it("hides filters and offers no dead-end action when the Library has no projects", async () => {
    libraryBoundary({ projects: [] });
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Start with a project" })).toBeVisible();
    expect(screen.queryByLabelText("Search projects")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Project layout" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show Library" })).not.toBeInTheDocument();
  });

  it("keeps one clear-filters action for a no-match search and routes empty views onward", async () => {
    libraryBoundary({ projects: [libraryProject()] });
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "Absent" } });
    expect(screen.getByRole("heading", { name: "No matching projects" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Clear search and filters" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    fireEvent.click(within(nav()).getByRole("button", { name: "Archived" }));
    expect(screen.getByRole("heading", { name: "No archived projects" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show Library" }));
    expect(screen.getByRole("heading", { name: "Project Library" })).toBeVisible();
  });

  it("attaches grouped, named desk controls to each focus-desk card and keeps them operable", async () => {
    const b = libraryBoundary({ projects: [libraryProject({ focusOrder: 0 }), libraryProject({ id: "beta", name: "Beta", path: "/repo/beta", focusOrder: 1 })] });
    const onOpen = vi.fn(); render(<LibraryWorkspace onOpen={onOpen} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    fireEvent.click(within(nav()).getByRole("button", { name: "Focus desk" }));
    const alpha = screen.getByRole("group", { name: "Focus desk actions for Alpha" });
    expect(within(alpha).getAllByRole("button").map(el => el.textContent)).toEqual(["Earlier", "Later", "Remove", "Activity", "Canvas"]);
    expect(within(alpha).getByRole("button", { name: "Move Alpha earlier" })).toBeDisabled();
    expect(within(screen.getByRole("group", { name: "Focus desk actions for Beta" })).getByRole("button", { name: "Move Beta later" })).toBeDisabled();
    fireEvent.click(within(alpha).getByRole("button", { name: "Canvas" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }), { view: "canvas" });
    fireEvent.click(within(alpha).getByRole("button", { name: "Remove Alpha from desk" }));
    await waitFor(() => expect(b.requests.filter(r => r.url.endsWith("/focus")).map(r => r.body.projectIds)).toEqual([["beta"]]));
  });

  it("confirms organization with a dismissible notice", async () => {
    libraryBoundary();
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add to desk" }));
    expect((await screen.findAllByText("Focus desk saved. Work and files are unchanged."))[0]).toBeVisible();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    const notice = screen.getByText("Focus desk saved. Work and files are unchanged.").closest(".pl-callout")!;
    expect(notice).toHaveAttribute("data-tone", "success");
    fireEvent.click(within(notice as HTMLElement).getByRole("button", { name: "Dismiss message" }));
    expect(screen.queryByText("Focus desk saved. Work and files are unchanged.")).not.toBeInTheDocument();
  });

  it("pins dialog actions outside the scrolling body and isolates the archive action", async () => {
    libraryBoundary();
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" }));
    const dialog = screen.getByRole("dialog", { name: "Alpha" });
    const body = dialog.querySelector(".pl-dialog-body")!;
    const footer = within(dialog).getByRole("button", { name: "Save changes" }).closest("footer")!;
    expect(footer.parentElement).toBe(dialog);
    expect(body.contains(footer)).toBe(false);
    const archive = within(dialog).getByRole("button", { name: "Archive project" });
    expect(body.contains(archive)).toBe(true);
    expect(archive).toHaveClass("pl-action--danger");
    expect(archive.closest(".pl-org-group")).toHaveClass("pl-org-group--danger");
    expect(within(dialog).getByRole("button", { name: "Open Canvas" }).closest(".pl-org-group")).not.toHaveClass("pl-org-group--danger");
    expect(within(dialog).getByLabelText("Add tag").tagName).toBe("INPUT");
  });

  it("keeps the Details tab order closing on Archive when nothing is dirty", async () => {
    libraryBoundary();
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" }));
    const dialog = screen.getByRole("dialog", { name: "Alpha" });
    within(dialog).getByLabelText("Display name").focus();
    fireEvent.keyDown(within(dialog).getByLabelText("Display name"), { key: "Tab", shiftKey: true });
    expect(within(dialog).getByRole("button", { name: "Archive project" })).toHaveFocus();
  });
});

describe("LibraryNotice", () => {
  it("announces errors as alerts and plain messages as polite status", () => {
    const { rerender } = render(<LibraryNotice tone="error" alert>Broken</LibraryNotice>);
    expect(screen.getByRole("alert")).toHaveTextContent("Broken");
    rerender(<LibraryNotice tone="info">Heads up</LibraryNotice>);
    expect(screen.getByRole("status")).toHaveTextContent("Heads up");
  });

  it("offers recovery actions and a labelled dismiss control only when asked", () => {
    const dismiss = vi.fn(); const retry = vi.fn();
    const { rerender } = render(<LibraryNotice tone="warning" alert actions={<button type="button" onClick={retry}>Retry</button>} onDismiss={dismiss}>Careful</LibraryNotice>);
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(retry).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce();
    rerender(<LibraryNotice tone="warning" alert>Careful</LibraryNotice>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("registration notice", () => {
  afterEach(() => { clearAuthToken(); vi.restoreAllMocks(); });
  it("explains an archived duplicate and can be dismissed", async () => {
    libraryBoundary({ projects: trio() });
    const { result } = renderHook(() => useRegistrationOpen(vi.fn()));
    act(() => result.current.open("old", "/repo/old"));
    await waitFor(() => expect(result.current.notice).toMatch(/already registered and archived/));
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });
});
