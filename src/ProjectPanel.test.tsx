import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectPanel } from "./ProjectPanel.tsx";
import { getProjectContext, updateProjectContext, type ProjectContext } from "./api.ts";
import type { SocketSubscribe } from "./use-socket.ts";

vi.mock("./api.ts", () => ({
  getProjectContext: vi.fn(),
  updateProjectContext: vi.fn(),
  getProjectTree: vi.fn(async () => ({ root: "project", tree: [{ name: "README.md", path: "README.md", type: "file" }] })),
}));

describe("ProjectPanel optional context", () => {
  it.each([
    { exists: false, content: "" },
    { exists: true, content: "   \n" },
  ])("opens the dashboard with empty context: %j", async (context) => {
    vi.mocked(getProjectContext).mockResolvedValue(context);
    const onOpenFile = vi.fn();
    const onSpawnContextExplorer = vi.fn();
    render(<ProjectPanel projectId="workspace-1" projectPath="/source/project"
      projectName="Project" nodes={[]} onOpenFile={onOpenFile}
      onSpawnContextExplorer={onSpawnContextExplorer} />);

    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    fireEvent.click(await screen.findByText("README.md"));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
    expect(screen.getByRole("button", { name: "dashboard" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "context" }));
    expect(screen.getByText(/Context is optional/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate with AI" }));
    expect(onSpawnContextExplorer).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });

  it("keeps the selected tab when context finishes loading", async () => {
    let resolveContext!: (context: ProjectContext) => void;
    vi.mocked(getProjectContext).mockReturnValue(new Promise((resolve) => { resolveContext = resolve; }));
    render(<ProjectPanel projectId="workspace-1" projectPath="/source/project"
      projectName="Project" nodes={[]} onSpawnContextExplorer={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "context" }));
    await act(async () => resolveContext({ exists: true, content: "Architecture notes" }));
    expect(screen.getByText("Architecture notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "context" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the dashboard usable when context cannot be loaded", async () => {
    vi.mocked(getProjectContext).mockRejectedValue(new Error("Context unavailable"));
    render(<ProjectPanel projectId="workspace-1" projectPath="/source/project"
      projectName="Project" nodes={[]} onSpawnContextExplorer={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "dashboard" })).toHaveAttribute("aria-pressed", "true");
  });

  it("supports writing and clearing context without removing the dashboard", async () => {
    vi.mocked(getProjectContext).mockResolvedValue({ exists: false, content: "" });
    vi.mocked(updateProjectContext).mockResolvedValue({ ok: true });
    render(<ProjectPanel projectId="workspace-1" projectPath="/source/project"
      projectName="Project" nodes={[]} onSpawnContextExplorer={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    await screen.findByText("README.md");
    fireEvent.click(screen.getByRole("button", { name: "context" }));
    fireEvent.click(screen.getByRole("button", { name: "Write Manually" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace context" }), { target: { value: "Use pnpm for tests." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Edit" });
    expect(screen.getByText("Use pnpm for tests.")).toBeInTheDocument();
    expect(updateProjectContext).toHaveBeenLastCalledWith("workspace-1", "Use pnpm for tests.");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace context" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Context is optional/)).toBeInTheDocument();
    expect(updateProjectContext).toHaveBeenLastCalledWith("workspace-1", "");
    fireEvent.click(screen.getByRole("button", { name: "dashboard" }));
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });
});

describe("ProjectPanel context updates", () => {
  it("refreshes file contents on tab entry and window focus without replacing an edit draft", async () => {
    vi.mocked(getProjectContext).mockResolvedValue({ exists: true, content: "Original instructions" });
    render(<ProjectPanel projectId="workspace-1" projectPath="/source/project"
      projectName="Project" nodes={[]} onSpawnContextExplorer={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    await screen.findByText("README.md");
    vi.mocked(getProjectContext).mockResolvedValue({ exists: true, content: "Edited outside the app" });
    fireEvent.click(screen.getByRole("button", { name: "context" }));
    await screen.findByText("Edited outside the app");
    vi.mocked(getProjectContext).mockResolvedValue({ exists: true, content: "Updated on focus" });
    fireEvent(window, new Event("focus"));
    await screen.findByText("Updated on focus");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace context" }), { target: { value: "Unsaved draft" } });
    vi.mocked(getProjectContext).mockResolvedValue({ exists: true, content: "Another external edit" });
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(screen.getByRole("textbox", { name: "Workspace context" })).toHaveValue("Unsaved draft");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Another external edit")).toBeInTheDocument();
  });

  it("replaces the empty state when a Leader publishes project context", async () => {
    vi.mocked(getProjectContext).mockResolvedValue({
      exists: true,
      content: "",
    });
    let listener: ((message: unknown) => void) | undefined;
    const subscribe = Object.assign(
      vi.fn((_topic: string, next: (message: unknown) => void) => {
        listener = next;
        return () => {};
      }),
      { supportsTopics: true as const },
    ) as SocketSubscribe;

    render(
      <ProjectPanel
        projectId="workspace-1"
        projectPath="/source/project"
        projectName="Project"
        onSpawnContextExplorer={vi.fn()}
        socketSubscribe={subscribe}
        nodes={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Project/ }));
    await screen.findByText("README.md");
    fireEvent.click(screen.getByRole("button", { name: "context" }));
    await screen.findByText(/Context is optional/);
    expect(subscribe).toHaveBeenCalledWith("project:workspace-1", expect.any(Function));

    act(() => listener?.({
      type: "project_context_updated",
      projectId: "workspace-1",
      content: "# Architecture\n\nMinions inherit this context.",
    }));

    await waitFor(() => expect(screen.queryByText(/Context is optional/)).toBeNull());
    expect(screen.getByText(/Minions inherit this context/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "context" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "dashboard" }));
    act(() => listener?.({ type: "project_context_updated", projectId: "workspace-1", content: "" }));
    expect(screen.getByRole("button", { name: "dashboard" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("README.md")).toBeInTheDocument();
  });
});


describe("ProjectPanel navigation clearance", () => {
  it("reports the visible edge on collapse, expansion, resize and removal", async () => {
    vi.mocked(getProjectContext).mockResolvedValue({ exists: false, content: "" });
    let collapsedRight = 146;
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { right: this.style.width === "340px" ? 358 : collapsedRight } as DOMRect;
    });
    let notifyResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const onRightEdgeChange = vi.fn();
    try {
      const { unmount } = render(<ProjectPanel projectId="workspace-1" projectPath="/source/project"
        projectName="Project" onSpawnContextExplorer={vi.fn()} nodes={[]} onRightEdgeChange={onRightEdgeChange} />);
      expect(onRightEdgeChange).toHaveBeenLastCalledWith(146);
      fireEvent.click(screen.getByRole("button", { name: /Project/ }));
      await screen.findByText("README.md");
      expect(onRightEdgeChange).toHaveBeenLastCalledWith(358);
      fireEvent.click(screen.getByRole("button", { name: "✕" }));
      expect(onRightEdgeChange).toHaveBeenLastCalledWith(146);
      collapsedRight = 210;
      act(() => notifyResize());
      expect(onRightEdgeChange).toHaveBeenLastCalledWith(210);
      unmount();
      expect(onRightEdgeChange).toHaveBeenLastCalledWith(0);
      expect(disconnect).toHaveBeenCalled();
    } finally {
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("ProjectPanel live touched paths", () => {
  it("shows dots for leader and minion activity from their worktree as messages arrive", async () => {
    vi.mocked(getProjectContext).mockResolvedValue({ exists: false, content: "" });
    const leader = {
      id: "leader-1", type: "leader", position: { x: 0, y: 0 }, size: { width: 300, height: 300 },
      data: { status: "running", taskName: "Fix docs", totalCost: 0, turns: 1, messages: [], worktreePath: "/tmp/worktree" },
    };
    const props = { projectId: "workspace-1", projectPath: "/source/project", projectName: "Project", onSpawnContextExplorer: vi.fn() };
    const { rerender } = render(<ProjectPanel {...props} nodes={[leader]} />);
    await screen.findByText("README.md");
    expect(screen.queryByRole("img", { name: "Fix docs touched README.md" })).toBeNull();
    rerender(<ProjectPanel {...props} nodes={[
      { ...leader, data: { ...leader.data, messages: [{ role: "tool", content: "Read", toolName: "Read", toolInput: { file_path: "/tmp/worktree/README.md" } }] } },
      { id: "minion-1", type: "minion", position: leader.position, size: leader.size, data: {
        status: "running", leaderId: leader.id, totalCost: 0, turns: 1, activeTaskIndex: 0, taskQueue: [{ title: "Review docs" }],
        messages: [{ role: "tool", content: "Edit", toolName: "Edit", toolInput: { file_path: "/tmp/worktree/README.md" } }],
      } },
    ]} />);
    expect(await screen.findByRole("img", { name: "Fix docs touched README.md" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Review docs touched README.md" })).toBeInTheDocument();
  });
});
