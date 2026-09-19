import { useReducer, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Canvas } from "./Canvas.tsx";
import { DockProvider } from "./BottomRightDock.tsx";
import { registerNodeType } from "./node-registry.ts";
import { canvasReducer } from "./canvas-state.ts";
import { graphReducer } from "./graph-runtime.ts";
import type { CanvasNode } from "./types.ts";
import { ActivityView } from "./ActivityView.tsx";
import { LeaderPromptBar } from "./nodes/leader/prompt/LeaderPromptBar.tsx";

registerNodeType({ type: "leader", label: "Leader", defaultSize: { width: 250, height: 180 }, render: ({ node }) => <>
  <h2>{(node.data as { taskName: string }).taskName}</h2>
  <LeaderPromptBar input={`Draft for ${node.id}`} onInputChange={() => {}} onKeyDown={() => {}} onSubmit={() => {}}
    placeholder="Reply" submitLabel="Send" disabled={false} active={false} />
</> });
const initial = { x: 40, y: 70, scale: .6 };
const initialNodes: CanvasNode[] = [
  { id: "first", type: "leader", position: { x: 100, y: 100 }, size: { width: 250, height: 180 }, data: { taskName: "Repair OAuth", sessionKey: "first-session", status: "idle", tasks: [] } },
  { id: "second", type: "leader", position: { x: 3000, y: 2200 }, size: { width: 250, height: 180 }, data: { taskName: "Review callback tests", sessionKey: "second-session", status: "waiting", tasks: [] } },
];
function Harness({ initialFocusNodeId = null, projectPanelRight = 0 }: { initialFocusNodeId?: string | null; projectPanelRight?: number }) {
  const [nodes, dispatch] = useReducer(canvasReducer, initialNodes);
  const [graph, graphDispatch] = useReducer(graphReducer, { edges: [] });
  const [transform, setTransform] = useState(initial);
  const [focusNodeId, setFocusNodeId] = useState(initialFocusNodeId);
  return <DockProvider><output data-testid="camera">{JSON.stringify(transform)}</output><Canvas projectPanelRight={projectPanelRight} nodes={nodes} dispatch={dispatch} graph={graph} graphDispatch={graphDispatch} transform={transform} setTransform={setTransform} focusNodeId={focusNodeId} onFocusNodeHandled={() => setFocusNodeId(null)} activitySessions={[{ sessionKey: "second-session", sessionId: null, cwd: "/tmp", status: "waiting", role: "leader", taskName: "Review callback tests" }]} /></DockProvider>;
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Canvas wayfinding integration", () => {
  it("centers to the right of the dashboard and reads its latest width", () => {
    const { rerender } = render(<Harness projectPanelRight={356} />);
    const focus = () => fireEvent.click(screen.getByTitle("Focus next active node (N)"));
    const camera = () => JSON.parse(screen.getByTestId("camera").textContent!);
    focus();
    expect(camera()).toEqual({ x: 561, y: 210, scale: 1 });
    rerender(<Harness projectPanelRight={180} />);
    focus();
    expect(camera()).toEqual({ x: 698 - 3125, y: 400 - 2290, scale: 1 });
    rerender(<Harness projectPanelRight={0} />);
    focus();
    expect(camera()).toEqual({ x: 375, y: 210, scale: 1 });
  });

  it("fits a focused node inside a narrow canvas without dashboard overlap", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    render(<Harness initialFocusNodeId="second" projectPanelRight={356} />);
    const camera = JSON.parse(screen.getByTestId("camera").textContent!);
    const left = 3000 * camera.scale + camera.x;
    const right = 3250 * camera.scale + camera.x;
    expect(camera.scale).toBeLessThan(1);
    expect(left).toBeGreaterThan(356 + 16);
    expect(right).toBeLessThan(600);
    expect((left + right) / 2).toBeCloseTo((372 + 600) / 2);
  });

  it("keeps all nodes clear of the dashboard when fitting the canvas", () => {
    render(<Harness projectPanelRight={356} />);
    fireEvent.click(screen.getByTitle("Fit view"));
    const camera = JSON.parse(screen.getByTestId("camera").textContent!);
    expect(100 * camera.scale + camera.x).toBeGreaterThan(372);
    expect(3250 * camera.scale + camera.x).toBeLessThan(1200);
    expect(100 * camera.scale + camera.y).toBeGreaterThan(0);
    expect(2380 * camera.scale + camera.y).toBeLessThan(800);
  });

  it("preserves a return view for a focus request received from Activity", () => {
    render(<Harness initialFocusNodeId="second" />);
    expect(screen.getByTestId("camera")).not.toHaveTextContent(JSON.stringify(initial));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("camera")).toHaveTextContent(JSON.stringify(initial));
  });
  it("finds an offscreen node, moves keyboard focus there, and returns to the original camera", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Find on canvas/ }));
    const input = screen.getByRole("textbox", { name: "Find on canvas" });
    fireEvent.change(input, { target: { value: "Review callback tests" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(screen.getByTestId("camera")).not.toHaveTextContent(JSON.stringify(initial));
    const prompt = document.querySelector('[data-canvas-node-id="second"] textarea');
    await waitFor(() => expect(prompt).toHaveFocus());
    expect(prompt).toHaveValue("Draft for second");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("camera")).toHaveTextContent(JSON.stringify(initial));
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-canvas-node-id]")).toHaveLength(2);
  });
  it("focuses the prompt when cycling active nodes and wraps back to the first", async () => {
    render(<Harness />);
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, "focus");
    fireEvent.keyDown(window, { key: "n", code: "KeyN" });
    const first = document.querySelector('[data-canvas-node-id="first"] textarea');
    const second = document.querySelector('[data-canvas-node-id="second"] textarea');
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.click(screen.getByTitle("Focus next active node (N)"));
    await waitFor(() => expect(second).toHaveFocus());
    fireEvent.click(screen.getByTitle("Focus next active node (N)"));
    await waitFor(() => expect(first).toHaveFocus());
    expect(first).toHaveValue("Draft for first");
    expect(second).toHaveValue("Draft for second");
    expect(first).not.toHaveAttribute("tabindex", "-1");
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });
  it("falls back to the card when the destination has no editable prompt", async () => {
    render(<Harness />);
    document.querySelector('[data-canvas-node-id="first"] textarea')?.setAttribute("disabled", "");
    fireEvent.keyDown(window, { key: "n", code: "KeyN" });
    await waitFor(() => expect(document.querySelector('[data-canvas-node-id="first"]')).toHaveFocus());
  });
  it("routes the attention list through the same camera history", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Needs attention 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Review callback tests.*Show on canvas/ }));
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.getByTestId("camera")).not.toHaveTextContent(JSON.stringify(initial));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("camera")).toHaveTextContent(JSON.stringify(initial));
  });
  it("opens detached work directly in Activity with focus on its inspector", async () => {
    render(<ActivityView initialSelectedKey="session:detached" sessions={[{ sessionKey: "detached", sessionId: null, cwd: "/tmp", status: "waiting", role: "leader", taskName: "Detached decision" }]}
      nodes={[]} onLaunchLeader={() => {}} onCommitLaunchLeader={() => {}} onCancelLaunchLeader={() => {}} onOpenInCanvas={() => {}} onExpandFullscreen={() => {}} onStopSession={() => {}} onAttachToCanvas={() => {}} onUpdateNodeData={() => {}} />);
    const inspector = screen.getByRole("complementary", { name: "Session details" });
    expect(inspector).toHaveTextContent("Detached decision");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Detached decision"));
  });
});
