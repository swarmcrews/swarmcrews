import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectList } from "./ProjectList.tsx";
import { clearAuthToken } from "./api.ts";
import { projectBoundary } from "./project-library/test-fixture.ts";
let boundary: ReturnType<typeof projectBoundary>;
let listProjects: ReturnType<typeof projectBoundary>["listProjects"];
let getProjectActivitySummary: ReturnType<typeof projectBoundary>["getProjectActivitySummary"];
let getHarnessReadiness: ReturnType<typeof projectBoundary>["getHarnessReadiness"];
let getRepositoryPathSuggestions: ReturnType<typeof projectBoundary>["getRepositoryPathSuggestions"];
let checkProjectGit: ReturnType<typeof projectBoundary>["checkProjectGit"];
let openProject: ReturnType<typeof projectBoundary>["openProject"];
let createProject: ReturnType<typeof projectBoundary>["createProject"];
function renderPicker(props: React.ComponentProps<typeof ProjectList>) {
  const result = render(<ProjectList {...props} />);
  fireEvent.click(screen.getByText("Add repository"));
  return result;
}

const ready = {
  schemaVersion: 1 as const,
  checkedAt: "2026-07-10T00:00:00Z",
  expiresAt: "2026-07-10T00:01:00Z",
  ready: true,
  readyHarnesses: ["codex"],
  harnesses: [{
    name: "codex",
    ready: true,
    state: "ready" as const,
    runtime: { available: true, source: "sdk_bundled" as const },
    auth: { authenticated: true, source: "cli_login" as const },
    checkedAt: "2026-07-10T00:00:00Z",
    expiresAt: "2026-07-10T00:01:00Z",
    durationMs: 2,
  }],
};

const project = {
  id: "p1",
  path: "/repo/alpha",
  name: "Alpha",
  lastOpened: "2026-07-10T00:00:00Z",
  hasSidecar: true,
};

describe("ProjectList journeys", () => {
  afterEach(() => { localStorage.removeItem("swarmcrews:starred-project-folders"); sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });
  beforeEach(() => {
    boundary = projectBoundary();
    ({ listProjects, getProjectActivitySummary, getHarnessReadiness, getRepositoryPathSuggestions, checkProjectGit, openProject, createProject } = boundary);
    vi.mocked(getProjectActivitySummary).mockResolvedValue([{ projectId: "p1", activeLeaders: 0, activeCrew: 0 }]);
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(getHarnessReadiness).mockResolvedValue(ready);
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({ platform: "posix", separator: "/", roots: [], directory: null, parent: null, breadcrumbs: [], entries: [], truncated: false });
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: true });
    vi.mocked(openProject).mockResolvedValue({ ...project, transform: { x: 0, y: 0, scale: 1 }, createdAt: "", updatedAt: "", nodes: [] });
    vi.mocked(createProject).mockResolvedValue({ ...project, transform: { x: 0, y: 0, scale: 1 }, createdAt: "", updatedAt: "", nodes: [] });
  });

  it("leads an empty Library with the prominent tutorial and an open registration panel", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    render(<ProjectList onOpenProject={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Start with a project" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Learn Swarmcrews" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Tutorial" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add repository" })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the tutorial reachable in Library tools once projects exist", async () => {
    render(<ProjectList onOpenProject={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    fireEvent.click(screen.getByLabelText("Library tools"));
    const actions = screen.getByRole("button", { name: "Refresh Library" }).parentElement!;
    expect(actions).toHaveClass("pl-tools-popover");
    expect(within(actions).getByRole("button", { name: "Tutorial" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Learn Swarmcrews" })).not.toBeInTheDocument();
  });

  it("presents Add repository as a disclosure with decorative icons and the label as its own text", async () => {
    render(<ProjectList onOpenProject={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    const summary = screen.getByText("Add repository");
    expect(summary.tagName).toBe("BUTTON");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect([...summary.querySelectorAll("svg")].every(icon => icon.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(summary.querySelectorAll("svg")).toHaveLength(2);
  });

  it("uses the compact brand sizing hook rather than the full-width default brand", async () => {
    render(<ProjectList onOpenProject={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    expect(screen.getByRole("img", { name: "Swarmcrews" })).toHaveClass("project-list-brand");
  });

  it.each(["initialize", "continue_without_git"] as const)("uses an empty search as a new destination and waits for Git choice: %s", async action => {
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    vi.mocked(getRepositoryPathSuggestions).mockImplementation(async request => ({
      platform: "posix", separator: "/", roots: [], directory: "/home/alex", parent: null,
      breadcrumbs: [{ name: "alex", path: "/home/alex" }], entries: [], truncated: false,
      ...(request.query ? { newDirectory: { name: "Fresh app", path: "/home/alex/Fresh app" } } : {}),
    }));
    renderPicker({ onOpenProject: vi.fn() });
    await screen.findByRole("button", { name: "Open Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await screen.findByRole("button", { name: "Star folder Home" });
    fireEvent.change(screen.getByRole("combobox", { name: "Search folders" }), { target: { value: "Fresh app" } });
    fireEvent.click(await screen.findByRole("button", { name: "Use new folder Fresh app" }));
    expect(screen.getByText("/home/alex/Fresh app")).toHaveClass("repository-path-picker__value");
    expect(screen.getByRole("heading", { name: "Register a repository" })).toBeVisible();
    expect(checkProjectGit).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("This folder is not a Git repository");
    expect(checkProjectGit).toHaveBeenCalledWith("/home/alex/Fresh app");
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: action === "initialize" ? "Initialize Git & create first commit" : "Continue without Git" }));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith("Untitled", "/home/alex/Fresh app", action));
    expect(openProject).not.toHaveBeenCalled();
  });

  it("offers saved locations without preselecting or opening a project", async () => {
    localStorage.setItem("swarmcrews:starred-project-folders", JSON.stringify(["/repo/saved"]));
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "posix", separator: "/", roots: [], directory: "/home/alex", parent: null,
      breadcrumbs: [{ name: "alex", path: "/home/alex" }], entries: [], truncated: false,
    });
    renderPicker({ onOpenProject: vi.fn() });
    await screen.findByRole("button", { name: "Open Alpha" });
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(getRepositoryPathSuggestions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    await screen.findByRole("button", { name: "Star folder Home" });
    fireEvent.click(screen.getByRole("button", { name: "Locations" }));
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "posix", separator: "/", roots: [], directory: "/repo/saved", parent: null,
      breadcrumbs: [{ name: "saved", path: "/repo/saved" }], entries: [], truncated: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Open starred folder /repo/saved" }));
    const use = await screen.findByRole("button", { name: "Use folder saved" });
    await waitFor(() => expect(use).toBeEnabled());
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(checkProjectGit).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(use);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(checkProjectGit).toHaveBeenCalledWith("/repo/saved"));
  });

  it("starts collapsed while projects load and stays collapsed when projects exist", async () => {
    let finish!: (value: typeof project[]) => void;
    vi.mocked(listProjects).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPicker({ onOpenProject: vi.fn() });
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Search folders" })).not.toBeInTheDocument();
    await act(async () => finish([project]));
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Search folders" })).not.toBeInTheDocument();
    expect(getRepositoryPathSuggestions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    expect(screen.getByRole("combobox", { name: "Search folders" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Enter a path instead" })).not.toBeInTheDocument();
  });

  it("opens automatically only after an empty project list is confirmed, and respects cancellation", async () => {
    let finish!: (value: typeof project[]) => void;
    vi.mocked(listProjects).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPicker({ onOpenProject: vi.fn() });
    expect(screen.queryByRole("combobox", { name: "Search folders" })).not.toBeInTheDocument();
    await act(async () => finish([]));
    expect(screen.getByRole("combobox", { name: "Search folders" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Register repository" }));
    expect(screen.queryByRole("combobox", { name: "Search folders" })).not.toBeInTheDocument();
  });

  it("does not auto-open the chooser when loading projects fails", async () => {
    vi.mocked(listProjects).mockRejectedValue(new Error("Could not load projects"));
    renderPicker({ onOpenProject: vi.fn() });
    await screen.findByText(/Couldn’t load Library/);
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Search folders" })).not.toBeInTheDocument();
  });

  it("preserves a manual draft started before an empty project list finishes loading", async () => {
    let finish!: (value: typeof project[]) => void;
    vi.mocked(listProjects).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderPicker({ onOpenProject: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/my/draft" } });
    await act(async () => finish([]));
    expect(screen.getByRole("textbox", { name: "Repository path" })).toHaveValue("/my/draft");
    expect(screen.queryByRole("combobox", { name: "Search folders" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter a path instead" })).not.toBeInTheDocument();
  });

  it("renders the Swarmcrews wordmark and existing leader mark", () => {
    renderPicker({ onOpenProject: vi.fn() });

    const logo = screen.getByRole("img", { name: "Swarmcrews" });
    expect(logo).toHaveClass("brand");
    expect(logo.querySelector(".brand__wordmark")).toBeInTheDocument();
    expect(logo.querySelector(".brand__mark")).toBeInTheDocument();
  });

  it("explains repository continuity and makes registration non-executing", async () => {
    renderPicker({ onOpenProject: vi.fn() });

    expect(screen.getByRole("heading", { name: "Open a repository" })).toBeVisible();
    expect(screen.getByText("Connect a repository to resume its Canvas and work history.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open repository" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Register repository" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Register repository" }));
    expect(screen.getByRole("heading", { name: "Register a repository" })).toBeVisible();
    expect(screen.getByText(/Agents only start when you launch work/)).toBeVisible();
  });

  it("renders and opens projects while readiness is still pending", async () => {
    let resolveReadiness!: (value: typeof ready) => void;
    vi.mocked(getHarnessReadiness).mockReturnValue(new Promise((resolve) => { resolveReadiness = resolve; }));
    const onOpenProject = vi.fn();
    renderPicker({ onOpenProject });

    fireEvent.click(await screen.findByRole("button", { name: "Open Alpha" }));
    expect(screen.queryByText("Loading Library…")).not.toBeInTheDocument();
    expect(onOpenProject).toHaveBeenCalledWith("p1", "/repo/alpha");
    await act(async () => resolveReadiness({ ...ready, ready: false }));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in");
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeEnabled();
  });

  it("keeps projects available when the readiness request fails", async () => {
    vi.mocked(getHarnessReadiness).mockRejectedValue(new Error("readiness unavailable"));
    renderPicker({ onOpenProject: vi.fn() });
    expect(await screen.findByRole("button", { name: "Open Alpha" })).toBeEnabled();
    expect(screen.queryByText("Loading Library…")).not.toBeInTheDocument();
  });

  it("loads only badge summaries after projects render without opening a socket", async () => {
    let resolveProjects!: (value: typeof project[]) => void;
    vi.mocked(listProjects).mockReturnValue(new Promise((resolve) => { resolveProjects = resolve; }));
    renderPicker({ onOpenProject: vi.fn() });
    expect(screen.getByText("Loading Library…")).toBeInTheDocument();
    expect(boundary.fetch.mock.calls.some(([url]) => /sessions|work-items|state$/.test(String(url)))).toBe(false);

    await act(async () => resolveProjects([project]));
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeEnabled();
    expect(boundary.fetch.mock.calls.some(([url]) => /sessions|work-items|state$/.test(String(url)))).toBe(false);
    expect(getProjectActivitySummary).toHaveBeenCalledWith(["p1"], expect.any(AbortSignal));

  });



  it("distinguishes a failed recent-projects load from an empty list and retries it", async () => {
    vi.mocked(listProjects)
      .mockRejectedValueOnce(new Error("recent projects unavailable"))
      .mockResolvedValueOnce([project]);
    renderPicker({ onOpenProject: vi.fn() });

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load Library");
    expect(screen.queryByText("Start with a project")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Library" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry Library" }));

    expect(await screen.findByRole("button", { name: "Open Alpha" })).toBeEnabled();
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it("shows the empty recent-projects state only after a successful empty load", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    renderPicker({ onOpenProject: vi.fn() });

    expect(await screen.findByText("Start with a project")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });





  it("opens a recent project without issuing a second server request", async () => {
    const onOpenProject = vi.fn();
    renderPicker({ onOpenProject });

    const openButton = await screen.findByRole("button", { name: "Open Alpha" });
    expect(openButton.tagName).toBe("BUTTON");
    expect(openButton).toHaveAttribute("type", "button");
    expect(openButton.querySelector("button")).toBeNull();
    fireEvent.click(openButton);

    expect(onOpenProject).toHaveBeenCalledWith("p1", "/repo/alpha");
    expect(openProject).not.toHaveBeenCalled();
  });

  it("opens a typed folder and trims surrounding whitespace", async () => {
    const onOpenProject = vi.fn();
    renderPicker({ onOpenProject });
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    const path = screen.getByRole("textbox", { name: "Repository path" });

    fireEvent.change(path, { target: { value: "  /repo/alpha  " } });
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(openProject).toHaveBeenCalledWith("/repo/alpha"));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith("p1", "/repo/alpha"));
  });

  it("withdraws a previous Git choice while changing folders and restores it only on cancel", async () => {
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    renderPicker({ onOpenProject: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/repo/plain" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByText("This folder is not a Git repository");
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    expect(screen.queryByRole("button", { name: "Initialize Git & create first commit" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Initialize Git & create first commit" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    expect(screen.queryByText("This folder is not a Git repository")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/repo/other" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    expect(screen.queryByText("This folder is not a Git repository")).not.toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("does not retry an old project operation while a replacement path is being edited", async () => {
    vi.mocked(openProject).mockRejectedValueOnce(new Error("Server unavailable"));
    renderPicker({ onOpenProject: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/repo/alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByText(/Couldn’t open repository/);
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Repository path" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(openProject).toHaveBeenCalledTimes(1);
  });

  it("selects a Windows server folder by keyboard without opening a project", async () => {
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "win32", separator: "\\", roots: [], directory: "C:\\repos", parent: "C:\\", breadcrumbs: [],
      entries: [{ name: "demo", path: "C:\\repos\\demo" }], truncated: false,
    });
    renderPicker({ onOpenProject: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));
    const input = screen.getByRole("combobox", { name: "Search folders" });
    fireEvent.focus(input);
    await screen.findByRole("option", { name: /demo/i });
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "win32", separator: "\\", roots: [], directory: "C:\\repos\\demo", parent: "C:\\repos", breadcrumbs: [{ name: "demo", path: "C:\\repos\\demo" }], entries: [], truncated: false,
    });
    fireEvent.keyDown(input, { key: "Enter" });
    const use = await screen.findByRole("button", { name: "Use folder demo" });
    await waitFor(() => expect(use).toBeEnabled());
    fireEvent.click(use);

    expect(screen.getByText("C:\\repos\\demo")).toBeVisible();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("creates with an explicit name and path", async () => {
    const onOpenProject = vi.fn();
    renderPicker({ onOpenProject });
    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Register repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/repo/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.change(screen.getByPlaceholderText(/Project name/), { target: { value: "New repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith("New repo", "/repo/new"));
  });

  it("requires an explicit choice before initializing Git and creating the first commit", async () => {
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    renderPicker({ onOpenProject: vi.fn() });
    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Register repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/repo/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Swarmcrews may run into issues");
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Initialize Git & create first commit" }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("Untitled", "/repo/new", "initialize");
    });
  });

  it("allows opening a non-Git folder only after acknowledging the warning", async () => {
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    renderPicker({ onOpenProject: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    const path = screen.getByRole("textbox", { name: "Repository path" });

    fireEvent.change(path, { target: { value: "/repo/plain" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue without Git" }));

    await waitFor(() => {
      expect(openProject).toHaveBeenCalledWith("/repo/plain", "continue_without_git");
    });
  });

  it("keeps recent projects usable when the optional readiness check fails", async () => {
    vi.mocked(getHarnessReadiness).mockRejectedValue(new Error("probe offline"));
    const onOpenProject = vi.fn();
    renderPicker({ onOpenProject });

    fireEvent.click(await screen.findByText("Alpha"));

    expect(onOpenProject).toHaveBeenCalledWith("p1", "/repo/alpha");
  });

  it("hides healthy harness status from the project picker", async () => {
    renderPicker({ onOpenProject: vi.fn() });

    await screen.findByText("Alpha");
    expect(screen.queryByText(/codex: ready/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check again/i })).not.toBeInTheDocument();
  });

  it("blocks initialization and offers a contextual recheck when no harness is ready", async () => {
    vi.mocked(getHarnessReadiness)
      .mockResolvedValueOnce({ ...ready, ready: false, readyHarnesses: [], harnesses: [{ ...ready.harnesses[0]!, ready: false, state: "unauthenticated" }] })
      .mockResolvedValueOnce(ready);
    renderPicker({ onOpenProject: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    const path = screen.getByRole("textbox", { name: "Repository path" });
    fireEvent.change(path, { target: { value: "/repo/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toBeDisabled());
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in to Claude or Codex");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toBeEnabled());
    expect(getHarnessReadiness).toHaveBeenLastCalledWith(true);
  });

  it("starts with compact organization and a collapsed registration form", async () => {
    render(<ProjectList onOpenProject={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Project Library" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Add repository" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name:"Open", hidden: true })).not.toBeVisible();
    expect(await screen.findByRole("button", { name:"Open Alpha" })).toBeEnabled();
  });
});
