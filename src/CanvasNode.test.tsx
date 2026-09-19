import { mockAnimationFrames } from "../tests/helpers/animation-frames.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CanvasNodeComponent } from "./CanvasNode.tsx";
import { registerNodeType } from "./node-registry.ts";
import type { CanvasNode, NodeRenderProps } from "./types.ts";
import { clearLeaderFullscreen, leaderFullscreenStore } from "./leader-fullscreen-request.ts";

const advanceFrame = mockAnimationFrames();

registerNodeType({
  type: "leader",
  label: "Leader",
  defaultSize: { width: 240, height: 160 },
  render: ({
    onDuplicateLeaderSetup,
    onOpenSystemModel,
    onSaveLeaderPreset,
  }: NodeRenderProps) => (
    <div>
      <div data-testid="leader-body">Leader body</div>
      <input aria-label="Leader title" />
      <button onClick={onDuplicateLeaderSetup}>Duplicate</button>
      <button onClick={onOpenSystemModel}>Open system model</button>
      <button onClick={() => onSaveLeaderPreset?.({ name: "Saved leader" })}>
        Save preset
      </button>
    </div>
  ),
});

function renderNode(props: Partial<Parameters<typeof CanvasNodeComponent>[0]> = {}) {
  const node: CanvasNode = {
    id: "leader-1",
    type: "leader",
    position: { x: 20, y: 30 },
    size: { width: 240, height: 160 },
    data: {},
  };

  const baseProps: Parameters<typeof CanvasNodeComponent>[0] = {
    node,
    isSelected: false,
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onUpdateData: vi.fn(),
    ...props,
  };

  return render(<CanvasNodeComponent {...baseProps} />);
}

describe("CanvasNodeComponent leader focusing", () => {
  it("only condenses after a drag threshold and restores the same live draft on drop", () => {
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    renderNode({ onDragStart, onDragEnd });
    const input = screen.getByLabelText("Leader title");
    fireEvent.change(input, { target: { value: "Unsent draft" } });
    const body = screen.getByTestId("leader-body");
    fireEvent.mouseDown(body, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 101, clientY: 101 });
    advanceFrame();
    expect(screen.queryByRole("status")).toBeNull();
    expect(onDragStart).not.toHaveBeenCalled();
    fireEvent.mouseMove(window, { clientX: 120, clientY: 120 });
    advanceFrame();
    expect(screen.getByRole("status")).toHaveTextContent("Release to place on canvas");
    expect(body).not.toBeVisible();
    expect(body.closest(".canvas-node-card")).toHaveStyle({ width: "240px", height: "160px" });
    expect(input).toBeInTheDocument();
    fireEvent.mouseUp(window, { clientX: 120, clientY: 120 });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("Leader title")).toBe(input);
    expect(input).toBeVisible();
    expect(input).toHaveValue("Unsent draft");
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it.each(["Escape", "blur"])("cancels with %s and clears the card and document drag styles", cancellation => {
    const onMove = vi.fn();
    renderNode({ onMove, dragZoneName: "Release prep" });
    fireEvent.mouseDown(screen.getByTestId("leader-body"), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 170 });
    advanceFrame();
    expect(screen.getByRole("status")).toHaveTextContent("Release into Release prep");
    if (cancellation === "Escape") fireEvent.keyDown(window, { key: "Escape" });
    else fireEvent.blur(window);
    expect(onMove).toHaveBeenLastCalledWith("leader-1", { x: 20, y: 30 }, true);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("leader-body")).toBeVisible();
    expect(document.body.style.userSelect).not.toBe("none");
    expect(document.body.style.cursor).not.toBe("grabbing");
  });

  it("focuses a leader node on double-click", () => {
    const onFocusNode = vi.fn();
    renderNode({ onFocusNode });

    fireEvent.doubleClick(screen.getByTestId("leader-body"));

    expect(onFocusNode).toHaveBeenCalledTimes(1);
    expect(onFocusNode).toHaveBeenCalledWith("leader-1");
  });

  it("does not focus when double-clicking an interactive child", () => {
    const onFocusNode = vi.fn();
    renderNode({ onFocusNode });

    fireEvent.doubleClick(screen.getByLabelText("Leader title"));

    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it("binds leader actions to the rendered node id", () => {
    const onDuplicateLeaderSetup = vi.fn();
    const onOpenSystemModel = vi.fn();
    const onSaveLeaderPreset = vi.fn(() => true);
    renderNode({
      onDuplicateLeaderSetup,
      onOpenSystemModel,
      onSaveLeaderPreset,
    });

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Open system model" }));
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));

    expect(onDuplicateLeaderSetup).toHaveBeenCalledWith("leader-1");
    expect(onOpenSystemModel).toHaveBeenCalledWith("leader-1");
    expect(onSaveLeaderPreset).toHaveBeenCalledWith("leader-1", {
      name: "Saved leader",
    });
  });
});

it("cancels scheduled movement and restores document styles when unmounted", () => {
  const onMove = vi.fn();
  const { unmount } = renderNode({ onMove });
  const userSelect = document.body.style.userSelect;
  const cursor = document.body.style.cursor;
  fireEvent.mouseDown(screen.getByTestId("leader-body"), { button: 0, clientX: 100, clientY: 100 });
  fireEvent.mouseMove(window, { clientX: 150, clientY: 170 });
  unmount();
  advanceFrame();
  fireEvent.mouseMove(window, { clientX: 200, clientY: 200 });
  expect(onMove).not.toHaveBeenCalled();
  expect(document.body.style.userSelect).toBe(userSelect);
  expect(document.body.style.cursor).toBe(cursor);
});

describe("leader context menu", () => {
  it("requests fullscreen for the right-clicked leader", () => {
    renderNode();
    fireEvent.contextMenu(screen.getByTestId("leader-body"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Open fullscreen/ }));
    expect(leaderFullscreenStore.getSnapshot()?.nodeId).toBe("leader-1");
    expect(screen.queryByRole("menu")).toBeNull();
    clearLeaderFullscreen();
  });

  it("keeps the menu within viewport bounds", () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { x: 0, y: 0, left: 0, top: 0, right: 288, bottom: 350, width: 288, height: 350, toJSON: () => ({}) },
    );
    try {
      renderNode();
      fireEvent.contextMenu(screen.getByTestId("leader-body"), { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 });
      expect(screen.getByRole("menu")).toHaveStyle({
        left: `${window.innerWidth - 288 - 8}px`, top: `${window.innerHeight - 350 - 8}px`,
      });
    } finally {
      measure.mockRestore();
    }
  });

  it("opens a viewport menu and moves only after choosing the workspace action", () => {
    const onMoveToZone = vi.fn();
    const onMove = vi.fn();
    renderNode({ onMoveToZone, onMove });
    fireEvent.contextMenu(screen.getByTestId("leader-body"), { clientX: 120, clientY: 140 });
    const menu = screen.getByRole("menu", { name: "Leader actions" });
    expect(menu.closest(".canvas-node-card")).toBeNull();
    expect(menu).toHaveStyle({ left: "120px", top: "140px" });
    expect(onMoveToZone).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Move to workspace…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to workspace…" }));
    expect(onMoveToZone).toHaveBeenCalledExactlyOnceWith("leader-1");
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it.each([
    ["Center on canvas", "onFocusNode"],
    ["Duplicate setup", "onDuplicateLeaderSetup"],
    ["Open system model", "onOpenSystemModel"],
  ] as const)("routes %s to the right-clicked leader", (label, callback) => {
    const action = vi.fn();
    renderNode({
      [callback]: action,
      node: { id: "target-leader", type: "leader", position: { x: 0, y: 0 },
        size: { width: 240, height: 160 }, data: { taskName: "Ship the release", sessionKey: "session-1" } },
    });
    fireEvent.contextMenu(screen.getByTestId("leader-body"));
    expect(screen.getByText("Ship the release")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(label) }));
    expect(action).toHaveBeenCalledExactlyOnceWith("target-leader");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("preserves the native context menu in editable fields", () => {
    const onMoveToZone = vi.fn();
    renderNode({ onMoveToZone });
    expect(fireEvent.contextMenu(screen.getByLabelText("Leader title"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onMoveToZone).not.toHaveBeenCalled();
  });

  it("navigates with arrow keys, closes on Escape, and restores focus", () => {
    renderNode({ onMoveToZone: vi.fn() });
    const input = screen.getByLabelText("Leader title");
    input.focus();
    fireEvent.contextMenu(screen.getByTestId("leader-body"));
    const first = screen.getByRole("menuitem", { name: /Open fullscreen/ });
    const last = screen.getByRole("menuitem", { name: "Move to workspace…" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(input).toHaveFocus();
  });

  it("hides session-only actions before a session exists and dismisses outside", () => {
    renderNode({ onOpenSystemModel: vi.fn() });
    fireEvent.contextMenu(screen.getByTestId("leader-body"));
    expect(screen.queryByRole("menuitem", { name: "Open system model" })).toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
