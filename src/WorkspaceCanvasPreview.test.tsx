import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCanvasPreview } from "./WorkspaceCanvasPreview.tsx";
import type { CanvasNode } from "./types.ts";
import { createZone, GLOBAL_WORKSPACE_ID } from "./canvas-zones.ts";

const node: CanvasNode = { id: "leader", type: "leader", position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, data: { taskName: "Release review", streamingText: "Do not render transcript" } };

describe("WorkspaceCanvasPreview", () => {
  it("repaints status changes despite memoization and supplies non-color status cues", () => {
    const props = { onOpenCanvas: () => {} };
    const { rerender } = render(<WorkspaceCanvasPreview {...props}
      nodes={[{ ...node, data: { taskName: "Release review", status: "running" } }]} />);
    expect(screen.getByRole("img")).toHaveAccessibleDescription("Shown agent statuses: Running: 1.");
    expect(screen.getByText("Release review — Running", { selector: "title" }).parentElement?.style.getPropertyValue("--preview-status"))
      .toBe("var(--status-running)");
    rerender(<WorkspaceCanvasPreview {...props}
      nodes={[{ ...node, data: { taskName: "Release review", status: "completed" } }]} />);
    expect(screen.getByRole("img")).toHaveAccessibleDescription("Shown agent statuses: Completed: 1.");
    expect(screen.getByText("Release review — Completed", { selector: "title" }).parentElement?.style.getPropertyValue("--preview-status"))
      .toBe("var(--status-success)");
    expect(screen.getByText("Completed", { selector: "text" })).toBeInTheDocument();
    expect(screen.queryByText("Release review — Running", { selector: "title" })).not.toBeInTheDocument();
  });

  it("shows an accessible read-only overview with a single navigation action", () => {
    const open = vi.fn();
    render(<WorkspaceCanvasPreview nodes={[node]} onOpenCanvas={open} />);
    expect(screen.getByRole("region", { name: "Workspace canvas Global" })).toBeVisible();
    expect(screen.getByRole("img", { name: /Global workspace layout, 1 node/ })).toBeVisible();
    expect(screen.getByText("1 node")).toBeVisible();
    expect(screen.queryByText("Do not render transcript")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open canvas" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("keeps an honest empty state and an actionable path to the canvas", () => {
    render(<WorkspaceCanvasPreview nodes={[]} onOpenCanvas={() => {}} />);
    expect(screen.getByText("No nodes in this workspace yet.")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open canvas" })).toBeEnabled();
  });

  it("updates on workspace and geometry changes, but keeps streaming content out of the map", () => {
    const { rerender } = render(<WorkspaceCanvasPreview nodes={[node]} onOpenCanvas={() => {}} />);
    const original = screen.getByRole("img").innerHTML;
    rerender(<WorkspaceCanvasPreview nodes={[{ ...node, data: { taskName: "Release review", streamingText: "More tokens" } }]} onOpenCanvas={() => {}} />);
    expect(screen.getByRole("img").innerHTML).toBe(original);
    const global = createZone(GLOBAL_WORKSPACE_ID, "Global");
    global.data.activeWorkspaceId = "empty";
    rerender(<WorkspaceCanvasPreview nodes={[node, global, createZone("empty", "Research")]} onOpenCanvas={() => {}} />);
    expect(screen.getByRole("region", { name: "Workspace canvas Research" })).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    rerender(<WorkspaceCanvasPreview nodes={[node, { ...node, id: "context", position: { x: 1000, y: 500 } }]} onOpenCanvas={() => {}} />);
    expect(screen.getByRole("img").innerHTML).not.toBe(original);
  });
});
