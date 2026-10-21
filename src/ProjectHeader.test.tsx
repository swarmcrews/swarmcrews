import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHeader } from "./ProjectHeader.tsx";
import { fromRecent, libraryProject, boundaryResponse } from "./project-library/test-fixture.ts";
import { clearAuthToken } from "./api.ts";
import type { SessionInfo } from "./use-socket.ts";

const projects = [
  { id: "project-1", name: "Alpha", path: "/repo/alpha", lastOpened: "2026-01-01", hasSidecar: true },
  { id: "project-2", name: "Beta", path: "/repo/beta", lastOpened: "2026-01-02", hasSidecar: true },
];

function renderHeader(overrides: Partial<React.ComponentProps<typeof ProjectHeader>> = {}) {
  const props: React.ComponentProps<typeof ProjectHeader> = {
    projectId: "project-1",
    name: "Alpha",
    saveStatus: "idle",
    lastSaved: null,
    onRename: vi.fn(),
    onBack: vi.fn(),
    onSwitchProject: vi.fn(),
    activeView: "activity",
    onViewChange: vi.fn(),
    settings: {},
    onSettingsChange: vi.fn(),
    ...overrides,
  };
  const view = render(<ProjectHeader {...props} />);
  return { ...props, rerender: (sessions: SessionInfo[]) => view.rerender(<ProjectHeader {...props} sessions={sessions} />) };
}

describe("ProjectHeader project navigation", () => {
  beforeEach(() => {
    clearAuthToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const body = url === "/api/auth/token" ? { token: "test" }
        : url === "/api/projects/library" ? { projects:projects.map(fromRecent), collections:[], focusRevision:0 }
        : url === "/api/projects/activity-summary" ? [] : undefined;
      if (body === undefined) throw new Error(`Unexpected fetch: ${url}`);
      return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    });
  });
  afterEach(() => {
    clearAuthToken();
    vi.restoreAllMocks();
  });

  it("opens search with Ctrl K, retains input on a list error and retries without closing the menu", async () => {
    let unavailable = true;
    const previous = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, options) => {
      if (String(input) === "/api/projects/library" && unavailable) return new Response(JSON.stringify({error:"offline"}), {status:503});
      return previous(input, options);
    });
    renderHeader();
    fireEvent.keyDown(window, {key:"k",ctrlKey:true});
    await screen.findByRole("button", {name:"Retry project list"});
    expect(screen.getByLabelText("Search projects")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Search projects"), {target:{value:"Beta"}});
    expect(screen.queryByText("No matching projects")).not.toBeInTheDocument();
    unavailable = false;
    fireEvent.click(screen.getByRole("button", {name:"Retry project list"}));
    expect(await screen.findByRole("menuitemradio", {name:/Beta/})).toBeVisible();
    expect(screen.getByLabelText("Search projects")).toHaveValue("Beta");
    expect(screen.queryByRole("menuitemradio", {name:/Alpha/})).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Search projects"), {key:"Escape"});
    expect(screen.getByRole("button", {name:"Alpha"})).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("orders by most recently opened, not Focus or name, with unopened projects last", async () => {
    const previous = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, options) => String(input) === "/api/projects/library"
      ? boundaryResponse({ projects: [
        libraryProject({ id: "old", name: "A focused", focusOrder: 0, lastOpened: "2026-01-01" }),
        libraryProject({ id: "never", name: "B unopened", lastOpened: null, createdAt: "2026-05-01" }),
        libraryProject({ id: "recent", name: "Z recent", lastOpened: "2026-04-01" }),
        libraryProject({ id: "archived", name: "Archived", archived: true, lastOpened: "2026-06-01" }),
      ], collections: [], focusRevision: 0 }) : previous(input, options));
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    const rows = await screen.findAllByRole("menuitemradio");
    expect(rows.map(row => row.querySelector(".project-switcher__project-name")?.textContent))
      .toEqual(["Z recent", "A focused", "B unopened"]);
  });

  it("uses one trimmed search for results and empty state, and resets on reopening", async () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    await screen.findByRole("menuitemradio", { name: /Beta/ });
    const search = screen.getByRole("searchbox", { name: "Search projects" });
    fireEvent.change(search, { target: { value: "  Beta  " } });
    expect(screen.getByRole("menuitemradio", { name: /Beta/ })).toBeVisible();
    expect(screen.queryByText("No matching projects")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "no match" } });
    expect(screen.getByText("No matching projects")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    fireEvent.change(search, { target: { value: "Beta" } });
    fireEvent.keyDown(search, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(await screen.findAllByRole("menuitemradio")).toHaveLength(2);
  });

  it("navigates from search with arrows and selects the first match with Enter", async () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    const beta = await screen.findByRole("menuitemradio", { name: /Beta/ });
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(beta).toHaveFocus();
    fireEvent.keyDown(beta, { key: "ArrowUp" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "Beta" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onSwitchProject).toHaveBeenCalledWith("project-2", "/repo/beta");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveFocus();
  });

  it("shows only the project identity without opening subtext in the switcher", async () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Alpha" });
    expect(trigger).toHaveAttribute("title", "Alpha");
    expect(trigger).toHaveTextContent(/^Alpha$/);
    expect(within(trigger).queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: "Switch project" });
    expect(within(menu).queryByText(/opened/i)).not.toBeInTheDocument();
  });

  it("uses the Swarmcrews logo to return to all projects", () => {
    const props = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "All projects" }));

    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it("lists projects and switches directly to another project", async () => {
    const props = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));

    expect(await screen.findByRole("menu", { name: "Switch project" })).toBeVisible();
    expect(screen.getByRole("menuitemradio", { name: /Alpha/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Beta/ }));

    expect(props.onSwitchProject).toHaveBeenCalledWith("project-2", "/repo/beta");
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Switch project" })).not.toBeInTheDocument();
    });
  });

  it("keeps project renaming available from the switcher", async () => {
    const onRename = vi.fn();
    renderHeader({ onRename });

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename project" }));
    const input = screen.getByDisplayValue("Alpha");
    fireEvent.change(input, { target: { value: "Alpha Prime" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith("Alpha Prime");
  });

  it("previews active leaders in their workspace and caps the visible roster", async () => {
    const session = (sessionKey: string, overrides: Partial<SessionInfo> = {}): SessionInfo => ({
      sessionKey, sessionId: null, taskName: sessionKey, role: "leader",
      status: "running", cwd: "/repo/alpha", ...overrides,
    });
    renderHeader({ sessions: [
      session("Build feature", { role: "leader" }),
      session("Review changes", { cwd: "/central/worktree", projectId: "project-1", status: "waiting" }),
      session("Write docs", { cwd: "/repo/alpha/.worktrees/docs", status: "creating" }),
      session("Overflow task"),
      session("Completed task", { status: "completed" }),
      session("Idle task", { status: "idle" }),
      session("Other workspace", { projectId: "project-2" }),
      session("Unrelated task", { cwd: "/repo/alphabet" }),
    ] });

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    const alpha = within(await screen.findByRole("menuitemradio", { name: /Alpha/ }));
    expect(alpha.getByText("4 active leaders")).toBeVisible();
    expect(alpha.getByText("0 crew")).toBeVisible();
    expect(alpha.getByText("Build feature")).toBeVisible();
    expect(alpha.getByText("Review changes")).toBeVisible();
    expect(alpha.getByText("Waiting")).toBeVisible();
    expect(alpha.getByText("Write docs")).toBeVisible();
    expect(alpha.getByText("Starting")).toBeVisible();
    expect(alpha.getByText("+1 more")).toBeVisible();
    for (const title of ["Overflow task", "Completed task", "Idle task", "Other workspace", "Unrelated task"]) {
      expect(alpha.queryByText(title)).not.toBeInTheDocument();
    }
    const beta = within(screen.getByRole("menuitemradio", { name: /Beta/ }));
    // Other projects use counts-only summaries, not leftover session inventory.
    expect(beta.queryByText("Other workspace")).not.toBeInTheDocument();
    expect(beta.queryByText("1 active leader")).not.toBeInTheDocument();
  });

  it("counts executing crew across leader rosters and child sessions without duplicates", async () => {
    const session = (sessionKey: string, overrides: Partial<SessionInfo> = {}): SessionInfo => ({
      sessionKey, sessionId: null, taskName: sessionKey, role: "minion",
      status: "running", cwd: "/repo/alpha", ...overrides,
    });
    const sessions = [
      session("leader-1", { role: "leader", runKey: "leader-run", activeMinions: [
        { taskId: "live", title: "Live", status: "running", sessionKey: "live" },
        { taskId: "starting", title: "Starting", status: "starting", sessionKey: null },
        { taskId: "planned", title: "Planned", status: "planned", sessionKey: null },
        { taskId: "blocked", title: "Blocked", status: "blocked", sessionKey: null },
        { taskId: "finished", title: "Finished", status: "running", sessionKey: "finished" },
      ] }),
      session("leader-2", { role: "leader", status: "idle", activeMinions: [
        { taskId: "roster-only", title: "Roster only", status: "running", sessionKey: "roster-only" },
      ] }),
      session("live"),
      session("graph-child", { parentRunKey: "leader-run", cwd: "/central/worktree" }),
      session("finished", { status: "completed" }),
      session("waiting", { status: "waiting" }),
      session("idle", { status: "idle" }),
      session("failed", { status: "error" }),
      session("cancelled", { status: "cancelled" }),
      session("default", { role: "default" }),
      session("other-project", { projectId: "project-2" }),
      session("other-leader-child", { parentRunKey: "other-leader" }),
    ];
    const props = renderHeader({ sessions });
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    const alphaItem = await screen.findByRole("menuitemradio", { name: /Alpha/ });
    const alpha = within(alphaItem);
    expect(alpha.getByText("1 active leader")).toBeVisible();
    expect(alpha.getByText("4 crew")).toBeVisible();
    expect(alpha.getByText("1 active leader").querySelector(".leader-status-icon")).toHaveAttribute("aria-hidden", "true");
    expect(alpha.getByText("4 crew").querySelector(".crew-icon")).toHaveAttribute("aria-hidden", "true");
    expect(alpha.queryByText("live")).not.toBeInTheDocument();
    expect(within(screen.getByRole("menuitemradio", { name: /Beta/ })).queryByText("1 crew")).not.toBeInTheDocument();

    props.rerender(sessions.map((entry) => ({ ...entry, status: "completed", activeMinions: [] })));
    expect(alpha.queryByText(/crew$/)).not.toBeInTheDocument();
    expect(alpha.queryByText(/active leader/)).not.toBeInTheDocument();
  });

  it("updates the open preview when agents finish without fetching projects again", async () => {
    const session: SessionInfo = {
      sessionKey: "leader-1", sessionId: null, role: "leader",
      taskName: "Live task", cwd: "/repo/alpha", status: "running",
    };
    const props = renderHeader({ sessions: [session] });
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(await screen.findByText("Live task")).toBeVisible();
    const projectCalls = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/projects/library").length;
    const calls = projectCalls();

    props.rerender([{ ...session, status: "completed" }]);

    expect(screen.queryByText("Live task")).not.toBeInTheDocument();
    expect(screen.queryByText(/active leader/)).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Switch project" })).toBeVisible();
    expect(projectCalls()).toBe(calls);
  });
});
