import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAuthToken } from "../api.ts";
import { projectBoundary } from "../project-library/test-fixture.ts";
import { ProjectsScreen } from "./ProjectsScreen.tsx";
let boundary: ReturnType<typeof projectBoundary>;
let { checkProjectGit, createProject, getRepositoryPathSuggestions, listProjects } = {} as ReturnType<typeof projectBoundary>;
beforeEach(() => { sessionStorage.clear(); boundary = projectBoundary(); ({ checkProjectGit, createProject, getRepositoryPathSuggestions, listProjects } = boundary); });
afterEach(() => { localStorage.removeItem("swarmcrews:starred-project-folders"); sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });
function summaryResponse(summary: Array<{projectId:string;activeLeaders:number;activeCrew:number}>) { boundary.getProjectActivitySummary.mockResolvedValue(summary); }

describe("ProjectsScreen", () => {
  it("keeps search and project views handy while disclosing secondary controls on demand", async () => {
    listProjects.mockResolvedValue([
      { id: "alpha", name: "Alpha", path: "/work/alpha", lastOpened: "", hasSidecar: true },
      { id: "beta", name: "Beta", path: "/work/beta", lastOpened: "", hasSidecar: true },
    ]);
    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    const disclosure = screen.getByRole("button", { name: "Filters and tools" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: "Collection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clean up missing folders" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Project view" })).toHaveValue("library");
    expect(screen.getByRole("button", { name: "Add repository" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "Beta" } });
    expect(screen.queryByRole("button", { name: "Open Alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Beta" })).toBeVisible();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Collection" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Clean up missing folders" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Sort projects"), { target: { value: "name" } });
    fireEvent.click(disclosure);
    expect(screen.queryByLabelText("Sort projects")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search projects" })).toHaveValue("Beta");
    fireEvent.click(disclosure);
    expect(screen.getByLabelText("Sort projects")).toHaveValue("name");
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeVisible();
    fireEvent.click(disclosure);
    fireEvent.change(screen.getByRole("combobox", { name: "Project view" }), { target: { value: "archived" } });
    expect(screen.queryByRole("button", { name: "Open Alpha" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Project view" })).toHaveValue("archived");
  });
  it.each(["initialize", "continue_without_git"] as const)("uses a new-folder destination only after registration and Git choice: %s", async action => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    vi.mocked(createProject).mockResolvedValue({ id: "new", name: "Fresh app", path: "/home/alex/Fresh app", createdAt: "", updatedAt: "", nodes: [], transform: { x: 0, y: 0, scale: 1 } });
    vi.mocked(getRepositoryPathSuggestions).mockImplementation(async request => ({
      platform: "posix", separator: "/", roots: [], directory: "/home/alex", parent: null,
      breadcrumbs: [{ name: "alex", path: "/home/alex" }], entries: [], truncated: false,
      ...(request.query ? { newDirectory: { name: "Fresh app", path: "/home/alex/Fresh app" } } : {}),
    }));
    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    await screen.findByRole("button", { name: "Star folder Home" });
    fireEvent.change(screen.getByRole("combobox", { name: "Search folders" }), { target: { value: "Fresh app" } });
    const use = await screen.findByRole("button", { name: "Use new folder Fresh app" });
    expect(screen.getByRole("button", { name: "Register project" })).toBeDisabled();
    fireEvent.click(use);
    expect(checkProjectGit).not.toHaveBeenCalled();
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Register project" }));
    await screen.findByText("This folder is not a Git repository");
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: action === "initialize" ? "Initialize Git & commit" : "Continue without Git" }));
    await waitFor(() => expect(createProject).toHaveBeenCalledWith("Untitled", "/home/alex/Fresh app", action));
  });
  it("keeps starred folders as shortcuts each time registration opens", async () => {
    localStorage.setItem("swarmcrews:starred-project-folders", JSON.stringify(["/work/saved"]));
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "posix", separator: "/", roots: [], directory: "/home/alex", parent: null,
      breadcrumbs: [{ name: "alex", path: "/home/alex" }], entries: [], truncated: false,
    });
    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    await screen.findByRole("button", { name: "Star folder Home" });
    expect(screen.getByRole("button", { name: "Register project" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Locations" }));
    expect(screen.getByRole("button", { name: "Open starred folder /work/saved" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel registration" }));
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    await screen.findByRole("button", { name: "Star folder Home" });
    fireEvent.click(screen.getByRole("button", { name: "Locations" }));
    expect(screen.getByRole("button", { name: "Open starred folder /work/saved" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Register project" })).toBeDisabled();
    expect(createProject).not.toHaveBeenCalled();
    expect(checkProjectGit).not.toHaveBeenCalled();
  });
  it("loads badge-only project summaries without any session inventory", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: "alpha", name: "Alpha", path: "/work/alpha", lastOpened: "", hasSidecar: true },
      { id: "beta", name: "Beta", path: "/work/beta", lastOpened: "", hasSidecar: true },
    ]);
    summaryResponse([
      { projectId: "alpha", activeLeaders: 2, activeCrew: 1 },
      { projectId: "beta", activeLeaders: 0, activeCrew: 0 },
    ]);
    const onSelectProject = vi.fn();
    render(<ProjectsScreen onSelectProject={onSelectProject} />);
    expect(await screen.findByRole("button", { name:"Running" })).toBeVisible();
    expect(screen.getByRole("article", { name: "Beta" }).querySelector(".pl-state, footer")).toBeNull();
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelectProject).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }), { view:"activity" });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("library/summary"))).toBe(true);
  });

  it("keeps unknown activity quiet after failure without inventing active work", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: "alpha", name: "Alpha", path: "/work/alpha", lastOpened: "", hasSidecar: true },
    ]);
    boundary.getProjectActivitySummary.mockRejectedValue(new Error("offline"));
    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    const project = await screen.findByRole("article", { name: "Alpha" });
    expect(project.querySelector(".pl-state, .pl-card-agents, footer")).toBeNull();
    expect(screen.queryByText(/0 active Leaders/)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no projects", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    render(<ProjectsScreen onSelectProject={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Start with a project")).toBeInTheDocument();
    });
  });

  it("explains that projects register repositories and Canvas workspaces organize work", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    render(<ProjectsScreen onSelectProject={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));

    expect(screen.getByRole("heading", { name: "Register a repository" })).toBeVisible();
    expect(screen.getByText(/A project connects Swarmcrews to one repository/)).toHaveTextContent(
      "Canvas workspaces, such as Global, organize work inside it.",
    );
    expect(screen.getByRole("button", { name: "Register project" })).toBeVisible();
  });

  it("creates a project from the mobile project page and selects it", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(createProject).mockResolvedValue({
      id: "new-project",
      path: "/work/new-project",
      name: "New Project",
      transform: { x: 0, y: 0, scale: 1 },
      createdAt: "2026-07-03T12:00:00.000Z",
      updatedAt: "2026-07-03T12:00:00.000Z",
      nodes: [],
    });
    const onSelectProject = vi.fn();

    render(<ProjectsScreen onSelectProject={onSelectProject} />);

    expect(screen.queryByRole("combobox", { name: "Search folders" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), {
      target: { value: "/work/new-project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register project" }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("New Project", "/work/new-project");
    });
    expect(onSelectProject).toHaveBeenCalledWith({
      id: "new-project",
      path: "/work/new-project",
      name: "New Project",
      lastOpened: "2026-07-03T12:00:00.000Z",
      hasSidecar: true,
    });
  });

  it("fills a browsed server folder without creating a project", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "win32", separator: "\\", roots: [], directory: "D:\\repos", parent: "D:\\", breadcrumbs: [],
      entries: [{ name: "demo", path: "D:\\repos\\demo" }], truncated: false,
    });
    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    const option = await screen.findByRole("option", { name: /demo/i });
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "win32", separator: "\\", roots: [], directory: "D:\\repos\\demo", parent: "D:\\repos", breadcrumbs: [],
      entries: [], truncated: false,
    });
    fireEvent.click(option);
    fireEvent.click(await screen.findByRole("button", { name: "Use folder demo" }));

    expect(screen.getByText("D:\\repos\\demo")).toBeVisible();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("warns before initializing Git for a new mobile project", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    vi.mocked(createProject).mockResolvedValue({
      id: "new-project",
      path: "/work/new-project",
      name: "New Project",
      transform: { x: 0, y: 0, scale: 1 },
      createdAt: "2026-07-03T12:00:00.000Z",
      updatedAt: "2026-07-03T12:00:00.000Z",
      nodes: [],
    });

    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), {
      target: { value: "/work/new-project" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Register project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Swarmcrews may run into issues without Git");
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Initialize Git & commit" }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("New Project", "/work/new-project", "initialize");
    });
  });

  it("hides the previous Git choice while a replacement folder is still a draft", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/work/plain" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    fireEvent.click(screen.getByRole("button", { name: "Register project" }));
    await screen.findByText("This folder is not a Git repository");
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    expect(screen.queryByRole("button", { name: "Initialize Git & commit" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/work/replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Initialize Git & commit" })).toBeVisible();
    expect(screen.getByText("/work/plain")).toBeVisible();
    expect(createProject).not.toHaveBeenCalled();
  });
});
