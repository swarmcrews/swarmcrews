import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { taskGraphPlanSnapshotViewSchema } from "../../shared/task-graph-planning-contracts.ts";
import { GraphInspector } from "./GraphInspector.tsx";
import { GraphPlanProposalCard, GraphPlanProposalDialog } from "./GraphPlanProposal.tsx";
import { GraphSummaryCard } from "./GraphSummaryCard.tsx";
import { Topology } from "./Topology.tsx";
import { WorkQueue } from "./WorkQueue.tsx";
import { createGraphFixture } from "./fixtures.ts";

const actions = () => ({ controlsEnabled: true, stale: false, onStart: vi.fn(), onReject: vi.fn(), onOpen: vi.fn() });
const proposal = () => taskGraphPlanSnapshotViewSchema.parse({
  proposalId: "proposal", workItemId: "work", primaryRunKey: "primary", revision: 1,
  baseProposalRevision: null, workPacketId: null, error: null, proposalRevision: 1, state: "ready", mode: "plan", objective: "Audit and refine Task Graph",
  acceptanceCriteria: ["Verified"], assumptions: [], questions: ["Which viewport?", "Which theme?", "Which audience?"],
  steps: [{ key: "audit", nodeId: null, title: "Design audit", objective: "Find issues", acceptanceCriteria: [], dependsOn: [], contextSelectors: [], inputBindings: {}, outputSchemas: {}, outputExamples: {}, executorClass: "reasoning", risk: "low", requiresApproval: false },
    { key: "fix", nodeId: null, title: "Design corrections", objective: "Fix issues", acceptanceCriteria: [], dependsOn: ["audit", "external"], contextSelectors: [], inputBindings: {}, outputSchemas: {}, outputExamples: {}, executorClass: "standard", risk: "low", requiresApproval: false }],
  materializedRevisionId: null, graphRunId: null, sourceSnapshotId: null, autoStartEligible: false,
  canStart: true, reviewRequirements: [{ gateId: "review", name: "Integration review", reason: "Review changes" }],
  topologyWarnings: [], updatedAt: 1,
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Task Graph usability regressions", () => {
  it("shows session models on graph cards, in the queue, and in attempt details", () => {
    const snapshot = createGraphFixture(2);
    const node = snapshot.nodes[0]!;
    node.requestedModel = "gpt-5.6-sol";
    node.currentAttempt!.model = "gpt-5.6-terra";
    node.currentAttempt!.harness = "codex";
    node.attemptHistory[0]!.model = "gpt-5.6-sol";
    const onSelect = vi.fn();
    const { unmount } = render(<Topology snapshot={snapshot} filter="all" selectedNodeId={null} onSelect={onSelect} />);
    const card = screen.getByRole("button", { name: /Task 0; Model: gpt-5.6-terra/ });
    expect(within(card).getByText("Model: gpt-5.6-terra")).toBeVisible();
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(node.id);
    unmount();
    const queue = render(<WorkQueue nodes={snapshot.nodes} onSelect={onSelect} />);
    expect(screen.getByText("Model: gpt-5.6-terra")).toBeVisible();
    queue.unmount();
    render(<GraphInspector snapshot={snapshot} onClose={vi.fn()} onAction={vi.fn()} initialSelectedNodeId={node.id} />);
    const detail = screen.getByRole("complementary", { name: "Task 0" });
    expect(within(detail).getByText("Model: gpt-5.6-terra")).toBeVisible();
    expect(within(detail).getByText(/Model: gpt-5.6-sol/)).toBeVisible();
  });

  it("distinguishes requested and default models from unrecorded session models", () => {
    const snapshot = createGraphFixture(3);
    snapshot.nodes[0]!.currentAttempt = null;
    snapshot.nodes[0]!.requestedModel = "sonnet";
    snapshot.nodes[1]!.currentAttempt = null;
    render(<Topology snapshot={snapshot} filter="all" selectedNodeId={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Requested model: sonnet")).toBeVisible();
    expect(screen.getByText("Model: default at launch")).toBeVisible();
    expect(screen.getByText("Model: not recorded")).toBeVisible();
  });

  it("contains initial reverse Tab and restores focus after closing rails", () => {
    render(<GraphInspector snapshot={createGraphFixture(10)} onClose={vi.fn()} onAction={vi.fn()} initialSelectedNodeId="node-1" />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).not.toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
    const closePlan = screen.getByRole("button", { name: "Collapse plan" });
    closePlan.focus(); fireEvent.click(closePlan);
    expect(screen.getByRole("button", { name: "Toggle plan rail" })).toHaveFocus();
    const closeDetails = screen.getByRole("button", { name: "Close task details" });
    closeDetails.focus(); fireEvent.click(closeDetails);
    expect(screen.getByRole("button", { name: "Toggle details rail" })).toHaveFocus();
  });

  it("offers full objective disclosure and a single stale refresh without enabling actions", () => {
    const refresh = vi.fn();
    const goal = "Preserve this complete requirement including its ending. ".repeat(12);
    render(<GraphInspector snapshot={createGraphFixture(1)} goal={goal} onClose={vi.fn()} onAction={vi.fn()} stale controlsEnabled={false} onRefresh={refresh} />);
    const disclose = screen.getByRole("button", { name: "Show full objective" });
    fireEvent.click(disclose);
    expect(disclose).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(disclose.getAttribute("aria-controls")!)).toHaveTextContent(goal.trim());
    expect(screen.getByRole("status")).toHaveTextContent("Cached state");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
  });

  it("keeps filter recovery visible when moving into the queue", () => {
    render(<GraphInspector snapshot={createGraphFixture(1)} onClose={vi.fn()} onAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    fireEvent.click(screen.getByRole("tab", { name: "Work queue" }));
    const queue = screen.getByRole("region", { name: "Windowed work queue" });
    expect(queue).toHaveTextContent("No tasks match this filter.");
    fireEvent.click(within(queue).getByRole("button", { name: "Clear filter" }));
    expect(within(queue).getByText("Task 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All nodes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("distinguishes an empty graph from filtered results", () => {
    render(<WorkQueue nodes={[]} onSelect={vi.fn()} />);
    expect(screen.getByText("No tasks in this graph yet.")).toBeInTheDocument();
    expect(screen.queryByText(/match this filter/)).not.toBeInTheDocument();
  });

  it("fills the measured queue viewport and recovers after deep-scroll filtering", () => {
    let height = 900;
    let resize = () => {};
    const disconnect = vi.fn();
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
    vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
    const nodes = createGraphFixture(1000).nodes;
    const { rerender, unmount } = render(<WorkQueue nodes={nodes} onSelect={vi.fn()} />);
    const queue = screen.getByRole("region");
    expect(within(queue).getAllByRole("button").length).toBeGreaterThanOrEqual(16);
    expect(within(queue).getAllByRole("button").length).toBeLessThan(40);
    height = 1200; act(() => resize());
    expect(within(queue).getAllByRole("button").length).toBeGreaterThanOrEqual(21);
    fireEvent.scroll(queue, { target: { scrollTop: 25000 } });
    rerender(<WorkQueue nodes={nodes.slice(0, 2)} onSelect={vi.fn()} />);
    expect(queue.scrollTop).toBe(0);
    expect(within(queue).getAllByRole("button")).toHaveLength(2);
    unmount(); expect(disconnect).toHaveBeenCalledOnce();
  });

  it("contains initial reverse Tab in proposals and restores the opener", () => {
    const opener = document.createElement("button"); document.body.append(opener); opener.focus();
    const close = vi.fn();
    const { unmount } = render(<GraphPlanProposalDialog snapshot={proposal()} actions={actions()} onClose={close} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Start work" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
    unmount(); expect(opener).toHaveFocus(); opener.remove();
  });

  it("keeps proposal focus stable across parent updates", () => {
    const { rerender } = render(<GraphPlanProposalDialog snapshot={proposal()} actions={actions()} onClose={vi.fn()} />);
    const start = screen.getByRole("button", { name: "Start work" }); start.focus();
    rerender(<GraphPlanProposalDialog snapshot={proposal()} actions={actions()} onClose={vi.fn()} />);
    expect(start).toHaveFocus();
  });

  it("describes completed task runtime without claiming it is waiting", () => {
    const snapshot = createGraphFixture(1);
    snapshot.nodes[0]!.logicalState = "succeeded";
    snapshot.nodes[0]!.currentAttempt!.state = "succeeded";
    render(<GraphInspector snapshot={snapshot} initialSelectedNodeId="node-0" onClose={vi.fn()} onAction={vi.fn()} />);
    expect(screen.getByText("Logical task is succeeded")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for dependencies")).not.toBeInTheDocument();
  });

  it("shows all proposal questions, dependency names and accurate blocked readiness", () => {
    const value = proposal(); value.canStart = false;
    const { unmount } = render(<GraphPlanProposalDialog snapshot={value} actions={actions()} onClose={vi.fn()} />);
    for (const question of value.questions) expect(screen.getByText(question)).toBeInTheDocument();
    expect(screen.getByText("After Design audit, external")).toBeInTheDocument();
    expect(screen.getByText(/not currently eligible to start/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start work" })).toBeDisabled();
    unmount();
    render(<GraphPlanProposalCard snapshot={proposal()} actions={actions()} />);
    expect(screen.getByText(/This work is eligible to start/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("suppresses All clear on cached summaries and counts attention once", () => {
    const snapshot = createGraphFixture(1);
    const node = snapshot.nodes[0]!;
    node.currentAttempt = null;
    node.logicalState = "failed";
    node.blocker = { category: "input", explanation: "Need input" };
    render(<GraphSummaryCard snapshot={snapshot} stale onOpen={vi.fn()} />);
    expect(screen.getByText("1 need attention")).toBeInTheDocument();
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("cached state");
  });
});
