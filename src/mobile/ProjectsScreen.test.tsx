import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkProjectGit, createProject, getHarnessReadiness, getRepositoryPathSuggestions, listProjects } from "../api.ts";
import { ProjectsScreen } from "./ProjectsScreen.tsx";

vi.mock("../api.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../api.ts")>(),
  checkProjectGit: vi.fn(async () => ({ isRepository: true })),
  createProject: vi.fn(),
  listProjects: vi.fn(),
  getHarnessReadiness: vi.fn(async () => ({ schemaVersion: 1, checkedAt: "", expiresAt: "", ready: true, readyHarnesses: ["claude"], harnesses: [] })),
  getRepositoryPathSuggestions: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(createProject).mockReset();
  vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: true });
  vi.mocked(listProjects).mockReset();
  vi.mocked(getHarnessReadiness).mockResolvedValue({ schemaVersion: 1, checkedAt: "", expiresAt: "", ready: true, readyHarnesses: ["claude"], harnesses: [] });
  vi.mocked(getRepositoryPathSuggestions).mockReset();
  vi.restoreAllMocks();
});

function summaryResponse(summary: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("auth/token") ? { token: "test" } : summary), { status: 200 })));
}

describe("ProjectsScreen", () => {
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
    expect(await screen.findByText("2 active Leaders · 1 active crew")).toBeInTheDocument();
    expect(screen.getByText("0 active Leaders · 0 active crew")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tutorial" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelectProject).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("activity-summary"))).toBe(true);
  });

  it("leaves unknown activity distinct from an authoritative zero after failure", async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { id: "alpha", name: "Alpha", path: "/work/alpha", lastOpened: "", hasSidecar: true },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<ProjectsScreen onSelectProject={vi.fn()} />);
    expect(await screen.findByText("Checking activity…")).toBeInTheDocument();
    expect(screen.queryByText(/0 active Leaders/)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no projects", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);

    render(<ProjectsScreen onSelectProject={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No recent projects found.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Start tutorial" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Tutorial" })).not.toBeInTheDocument();
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

    expect(screen.queryByLabelText("Folders on the server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    fireEvent.change(screen.getByLabelText("Folders on the server"), {
      target: { value: "/work/new-project" },
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    const option = await screen.findByRole("option", { name: /demo/i });
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "win32", separator: "\\", roots: [], directory: "D:\\repos\\demo", parent: "D:\\repos", breadcrumbs: [],
      entries: [], truncated: false,
    });
    fireEvent.click(option);
    fireEvent.click(await screen.findByRole("button", { name: "Use this folder" }));

    expect(screen.getByRole("combobox", { name: "Folders on the server" })).toHaveValue("D:\\repos\\demo");
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
    fireEvent.change(screen.getByLabelText("Folders on the server"), {
      target: { value: "/work/new-project" },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Register project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Swarmcrews may run into issues without Git");
    expect(createProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Initialize Git & commit" }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("New Project", "/work/new-project", "initialize");
    });
  });
});
