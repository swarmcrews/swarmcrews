import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectList } from "./ProjectList.tsx";
import {
  checkProjectGit,
  createProject,
  deleteProject,
  getHarnessReadiness,
  getProjectActivitySummary,
  getRepositoryPathSuggestions,
  listProjects,
  openProject,
} from "./api.ts";
import { useSocket } from "./use-socket.ts";

const socketSend = vi.fn();

vi.mock("./use-socket.ts", () => ({
  useSocket: vi.fn(() => ({
    connected: true,
    send: socketSend,
    subscribe: vi.fn(),
  })),
}));

vi.mock("./api.ts", () => ({
  listProjects: vi.fn(),
  getProjectActivitySummary: vi.fn(),
  checkProjectGit: vi.fn(),
  createProject: vi.fn(),
  openProject: vi.fn(),
  deleteProject: vi.fn(),
  getHarnessReadiness: vi.fn(),
  getRepositoryPathSuggestions: vi.fn(),
}));

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
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getProjectActivitySummary).mockResolvedValue([{ projectId: "p1", activeSessions: 0 }]);
    vi.mocked(listProjects).mockResolvedValue([project]);
    vi.mocked(getHarnessReadiness).mockResolvedValue(ready);
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({ platform: "posix", separator: "/", roots: [], directory: null, parent: null, breadcrumbs: [], entries: [], truncated: false });
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: true });
    vi.mocked(openProject).mockResolvedValue({ ...project, transform: { x: 0, y: 0, scale: 1 }, createdAt: "", updatedAt: "", nodes: [] });
    vi.mocked(createProject).mockResolvedValue({ ...project, transform: { x: 0, y: 0, scale: 1 }, createdAt: "", updatedAt: "", nodes: [] });
    vi.mocked(deleteProject).mockResolvedValue({});
  });

  it("renders the Swarmcrews wordmark and existing leader mark", () => {
    render(<ProjectList onOpenProject={vi.fn()} />);

    const logo = screen.getByRole("img", { name: "Swarmcrews" });
    expect(logo).toHaveClass("brand");
    expect(logo.querySelector(".brand__wordmark")).toBeInTheDocument();
    expect(logo.querySelector(".brand__mark")).toBeInTheDocument();
  });

  it("renders and opens projects while readiness is still pending", async () => {
    let resolveReadiness!: (value: typeof ready) => void;
    vi.mocked(getHarnessReadiness).mockReturnValue(new Promise((resolve) => { resolveReadiness = resolve; }));
    const onOpenProject = vi.fn();
    render(<ProjectList onOpenProject={onOpenProject} />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Alpha" }));
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(onOpenProject).toHaveBeenCalledWith("p1", "/repo/alpha");
    await act(async () => resolveReadiness({ ...ready, ready: false }));
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in");
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeEnabled();
  });

  it("keeps projects available when the readiness request fails", async () => {
    vi.mocked(getHarnessReadiness).mockRejectedValue(new Error("readiness unavailable"));
    render(<ProjectList onOpenProject={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Open Alpha" })).toBeEnabled();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("loads only badge summaries after projects render without opening a socket", async () => {
    let resolveProjects!: (value: typeof project[]) => void;
    vi.mocked(listProjects).mockReturnValue(new Promise((resolve) => { resolveProjects = resolve; }));
    render(<ProjectList onOpenProject={vi.fn()} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(useSocket).not.toHaveBeenCalled();

    await act(async () => resolveProjects([project]));
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeEnabled();
    expect(useSocket).not.toHaveBeenCalled();
    expect(getProjectActivitySummary).toHaveBeenCalledWith(["p1"], expect.any(AbortSignal));
    expect(socketSend).not.toHaveBeenCalled();
  });

  it("shows a sleeping project when it has no active sessions", async () => {
    render(<ProjectList onOpenProject={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "Alpha is sleeping with no active sessions" })).toHaveClass(
      "project-list-recent__activity--sleeping",
    );
    expect(screen.getByText("0 active sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tutorial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start tutorial" })).not.toBeInTheDocument();
  });

  it("promotes the tutorial only after an empty project list loads, even without a ready harness", async () => {
    vi.mocked(listProjects).mockResolvedValue([]);
    vi.mocked(getHarnessReadiness).mockResolvedValue({ ...ready, ready: false });
    render(<ProjectList onOpenProject={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Start tutorial" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Start tutorial" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Tutorial" })).not.toBeInTheDocument();
  });

  it("renders the scoped active count returned by the server", async () => {
    vi.mocked(getProjectActivitySummary).mockResolvedValue([{ projectId: "p1", activeSessions: 3 }]);
    render(<ProjectList onOpenProject={vi.fn()} />);

    const activity = await screen.findByRole("img", { name: "Alpha has 3 active sessions" });
    expect(activity).toHaveClass("project-list-recent__activity--active");
    expect(activity.querySelector('img[src="/icons/minion.svg"]')).toBeInTheDocument();
    expect(screen.getByText("3 active sessions")).toHaveClass("project-list-recent__session-count--active");
  });

  it("opens a recent project without issuing a second server request", async () => {
    const onOpenProject = vi.fn();
    render(<ProjectList onOpenProject={onOpenProject} />);

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
    render(<ProjectList onOpenProject={onOpenProject} />);
    const path = await screen.findByPlaceholderText("/path/to/existing/project...");

    fireEvent.change(path, { target: { value: "  /repo/alpha  " } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(openProject).toHaveBeenCalledWith("/repo/alpha"));
    expect(onOpenProject).toHaveBeenCalledWith("p1", "/repo/alpha");
  });

  it("selects a Windows server folder by keyboard without opening a project", async () => {
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({
      platform: "win32", separator: "\\", roots: [], directory: "C:\\repos", parent: "C:\\", breadcrumbs: [],
      entries: [{ name: "demo", path: "C:\\repos\\demo" }], truncated: false,
    });
    render(<ProjectList onOpenProject={vi.fn()} />);
    const input = await screen.findByRole("combobox", { name: "Folders on the server" });
    fireEvent.focus(input);
    await screen.findByRole("option", { name: /demo/i });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(input).toHaveValue("C:\\repos\\demo");
    expect(openProject).not.toHaveBeenCalled();
  });

  it("creates with an explicit name and path", async () => {
    const onOpenProject = vi.fn();
    render(<ProjectList onOpenProject={onOpenProject} />);
    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));
    fireEvent.change(screen.getByPlaceholderText("/path/to/new/project..."), { target: { value: "/repo/new" } });
    fireEvent.change(screen.getByPlaceholderText(/Project name/), { target: { value: "New repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createProject).toHaveBeenCalledWith("New repo", "/repo/new"));
  });

  it("requires an explicit choice before initializing Git and creating the first commit", async () => {
    vi.mocked(checkProjectGit).mockResolvedValue({ isRepository: false });
    render(<ProjectList onOpenProject={vi.fn()} />);
    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));
    fireEvent.change(screen.getByPlaceholderText("/path/to/new/project..."), { target: { value: "/repo/new" } });
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
    render(<ProjectList onOpenProject={vi.fn()} />);
    const path = await screen.findByPlaceholderText("/path/to/existing/project...");

    fireEvent.change(path, { target: { value: "/repo/plain" } });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue without Git" }));

    await waitFor(() => {
      expect(openProject).toHaveBeenCalledWith("/repo/plain", "continue_without_git");
    });
  });

  it("keeps recent projects usable when the optional readiness check fails", async () => {
    vi.mocked(getHarnessReadiness).mockRejectedValue(new Error("probe offline"));
    const onOpenProject = vi.fn();
    render(<ProjectList onOpenProject={onOpenProject} />);

    fireEvent.click(await screen.findByText("Alpha"));

    expect(onOpenProject).toHaveBeenCalledWith("p1", "/repo/alpha");
  });

  it("hides healthy harness status from the project picker", async () => {
    render(<ProjectList onOpenProject={vi.fn()} />);

    await screen.findByText("Alpha");
    expect(screen.queryByText(/codex: ready/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check again/i })).not.toBeInTheDocument();
  });

  it("blocks initialization and offers a contextual recheck when no harness is ready", async () => {
    vi.mocked(getHarnessReadiness)
      .mockResolvedValueOnce({ ...ready, ready: false, readyHarnesses: [], harnesses: [{ ...ready.harnesses[0]!, ready: false, state: "unauthenticated" }] })
      .mockResolvedValueOnce(ready);
    render(<ProjectList onOpenProject={vi.fn()} />);
    const path = await screen.findByPlaceholderText("/path/to/existing/project...");
    fireEvent.change(path, { target: { value: "/repo/new" } });

    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Sign in to Claude or Codex");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Open" })).toBeEnabled());
    expect(getHarnessReadiness).toHaveBeenLastCalledWith(true);
  });

  it("only removes the selected recent project after confirmation without opening it", async () => {
    vi.mocked(listProjects).mockResolvedValue([project, { ...project, id: "p2", name: "Beta", path: "/repo/beta" }]);
    const onOpenProject = vi.fn();
    render(<ProjectList onOpenProject={onOpenProject} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove" }))[0]!);

    expect(screen.getByRole("dialog", { name: 'Remove "Alpha" from recent projects?' })).toHaveTextContent("Your project folder and files will remain on disk");
    expect(deleteProject).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeInTheDocument();
    expect(onOpenProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));

    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Beta" })).toBeInTheDocument();
    expect(deleteProject).toHaveBeenCalledTimes(1);
    expect(deleteProject).toHaveBeenCalledWith("p1");
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it.each(["cancel", "escape", "backdrop"])("keeps the project when confirmation is dismissed using %s", async (dismissal) => {
    const onOpenProject = vi.fn();
    render(<ProjectList onOpenProject={onOpenProject} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    if (dismissal === "cancel") {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    } else if (dismissal === "escape") {
      fireEvent.keyDown(window, { key: "Escape" });
    } else {
      fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    }

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeInTheDocument();
    expect(deleteProject).not.toHaveBeenCalled();
    expect(onOpenProject).not.toHaveBeenCalled();
  });
});
