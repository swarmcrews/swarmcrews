/**
 * Behavior tests for the Leader fullscreen cockpit.
 *
 * Mirrors the test patterns from `MarkdownNode.test.tsx`'s focus-mode
 * suite: confirms toggle-button + keyboard-shortcut + Esc semantics,
 * portal mount target, body-scroll lock, and that the 3-pane cockpit
 * shell renders the activity rail, conversation, and context drawer.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CanvasPresentationContext } from "../../../canvas/CanvasPresentation.tsx";
import { HeaderMenu } from "../HeaderMenu.tsx";
import { LeaderNodeRenderer } from "../../LeaderNode.tsx";
import { LEADER_DEFAULT_DATA, type LeaderData } from "../types.ts";
import type { CanvasNode, NodeRenderProps } from "../../../types.ts";
import { requestLeaderFullscreen, resetLeaderFullscreenRequest } from "../../../leader-fullscreen-request.ts";

afterEach(() => resetLeaderFullscreenRequest());

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
});

interface ProbeProps {
  initial?: Partial<LeaderData>;
}

function Probe({ initial }: ProbeProps) {
  const [data, setData] = useState<LeaderData>({
    ...LEADER_DEFAULT_DATA,
    ...initial,
  });
  const node: CanvasNode = {
    id: "leader-fs-test",
    type: "leader",
    position: { x: 0, y: 0 },
    size: { width: 560, height: 520 },
    data,
  };
  const props: NodeRenderProps = {
    node,
    isSelected: false,
    onUpdateData: (next) => setData(next as LeaderData),
    socketSend: () => {
      /* no-op — fullscreen tests don't exercise the WS */
    },
    socketSubscribe: () => () => {
      /* no-op subscription */
    },
  };
  return <LeaderNodeRenderer {...props} />;
}

describe("LeaderNode fullscreen cockpit", () => {
  it.each(["button", "Escape", "Cmd+Shift+F", "Ctrl+Shift+F"])(
    "%s returns to the external entry point once, without affecting later canvas opens",
    async (exitMethod) => {
      const onExit = vi.fn();
      requestLeaderFullscreen("leader-fs-test", onExit);
      render(<Probe />);
      expect(screen.getByTestId("leader-fullscreen-overlay")).toBeInTheDocument();

      await act(async () => {
        if (exitMethod === "button") {
          fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
        } else {
          fireEvent.keyDown(window, exitMethod === "Escape" ? { key: "Escape" } : {
            key: "f", shiftKey: true,
            metaKey: exitMethod === "Cmd+Shift+F", ctrlKey: exitMethod === "Ctrl+Shift+F",
          });
        }
      });
      expect(screen.queryByTestId("leader-fullscreen-overlay")).toBeNull();
      expect(onExit).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
      });
      expect(onExit).toHaveBeenCalledTimes(1);
    },
  );

  it("does not render the overlay by default", () => {
    render(<Probe />);
    expect(
      document.querySelector("[data-testid='leader-fullscreen-overlay']"),
    ).toBeNull();
    // Header still shows the enter-fullscreen button.
    expect(
      screen.getByRole("button", { name: "Enter fullscreen" }),
    ).toBeInTheDocument();
  });

  it("clicking the fullscreen button portals the cockpit and locks body scroll", async () => {
    render(<Probe />);

    const enter = screen.getByRole("button", { name: "Enter fullscreen" });
    expect(enter).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(enter);
    });

    const overlay = document.querySelector(
      "[data-testid='leader-fullscreen-overlay']",
    );
    expect(overlay).not.toBeNull();
    // Portal target is document.body — escapes the canvas CSS transform.
    expect(overlay?.parentElement).toBe(document.body);

    // 3-pane structure is present.
    expect(
      overlay?.querySelector("[data-testid='leader-fullscreen-activity-rail']"),
    ).not.toBeNull();
    expect(
      overlay?.querySelector("[data-testid='leader-fullscreen-conversation']"),
    ).not.toBeNull();
    expect(
      overlay?.querySelector(
        "[data-testid='leader-fullscreen-context-drawer']",
      ),
    ).not.toBeNull();

    // Body scroll lock engaged.
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("Esc exits the cockpit and restores body scroll", async () => {
    render(<Probe />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });
    expect(
      document.querySelector("[data-testid='leader-fullscreen-overlay']"),
    ).not.toBeNull();

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(
      document.querySelector("[data-testid='leader-fullscreen-overlay']"),
    ).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it.each([false, true])("retires a real %s sibling/selected Canvas HeaderMenu before foreground outer Escape", async sibling => {
    render(<>{sibling && <section className="canvas-node-card"><HeaderMenu data={LEADER_DEFAULT_DATA}
      onReset={() => {}} onExportLog={() => {}} /></section>}<Probe /></>);
    fireEvent.click(screen.getAllByRole("button", { name: "More leader actions" })[0]!);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Export log" })).toHaveFocus());
    const enter = screen.getByRole("button", { name: "Enter fullscreen" }); enter.focus();
    fireEvent.keyDown(enter, { key: "F", ctrlKey: true, shiftKey: true });
    const cockpit = screen.getByTestId("leader-fullscreen-overlay");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Leader actions" })).toBeNull());
    expect(within(cockpit).getByRole("button", { name: "Exit fullscreen" })).toHaveFocus();
    fireEvent.keyDown(within(cockpit).getByRole("button", { name: "Exit fullscreen" }), { key: "Escape" });
    expect(screen.queryByTestId("leader-fullscreen-overlay")).toBeNull();
  });

  it("reveals the whole focused workspace tab on focus and selected-layout change", () => {
    render(<Probe initial={{ renderState: { layout: {}, components: [{ id: "context", type: "text", content: "Simulated decision" }] } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    const nav = screen.getByRole("navigation", { name: "Leader workspace" });
    const dashboard = within(nav).getByRole("button", { name: "Dashboard" });
    // DOM geometry boundary simulation only; native paint/reflow is covered in e2e.
    vi.spyOn(nav, "getBoundingClientRect").mockImplementation(() => new DOMRect(42, 0, 236, 60));
    vi.spyOn(dashboard, "getBoundingClientRect").mockImplementation(() => new DOMRect(42 + 179 - nav.scrollLeft, 0, 165, 60));
    nav.scrollLeft = 238; dashboard.focus();
    expect(nav.scrollLeft).toBe(179);
    nav.scrollLeft = 238; fireEvent.click(dashboard);
    expect(dashboard).toHaveAttribute("aria-current", "page");
    expect(nav.scrollLeft).toBe(179);
  });

  it("reveals attention-selected Dashboard when focus is outside the tab rail without taking focus", () => {
    render(<Probe initial={{ renderState: { layout: {}, components: [{ id: "decision", type: "form", fields: [{ id: "choice", label: "Choice", kind: "text" }] }] } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    const nav = screen.getByRole("navigation", { name: "Leader workspace" });
    const dashboard = within(nav).getByRole("button", { name: "Dashboard" });
    vi.spyOn(nav, "getBoundingClientRect").mockImplementation(() => new DOMRect(42, 0, 236, 60));
    vi.spyOn(dashboard, "getBoundingClientRect").mockImplementation(() => new DOMRect(42 + 179 - nav.scrollLeft, 0, 165, 60));
    const attention = screen.getByRole("button", { name: /question needs your response/ });
    nav.scrollLeft = 238; attention.focus(); fireEvent.click(attention);
    expect(dashboard).toHaveAttribute("aria-current", "page");
    expect(nav.scrollLeft).toBe(179);
    expect(dashboard).not.toHaveFocus();
  });

  it("observes tab geometry as well as the rail and prioritizes native focus over selection", () => {
    const observed = new Map<Element, () => void>();
    // Browser geometry boundary: delayed font/weight sizing can change tabs without changing rail size.
    vi.stubGlobal("ResizeObserver", class {
      private own = new Set<Element>();
      private callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe(element: Element) { this.own.add(element); observed.set(element, this.callback); }
      disconnect() { for (const element of this.own) observed.delete(element); }
    });
    try {
      const result = render(<Probe initial={{ renderState: { layout: {}, components: [{ id: "context", type: "text", content: "Simulated decision" }] } }} />);
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
      const nav = screen.getByRole("navigation", { name: "Leader workspace" });
      const dashboard = within(nav).getByRole("button", { name: "Dashboard" });
      const conversation = within(nav).getByRole("button", { name: "Conversation" });
      expect(observed.has(nav)).toBe(true); expect(observed.has(dashboard)).toBe(true);
      vi.spyOn(nav, "getBoundingClientRect").mockImplementation(() => new DOMRect(42, 0, 236, 60));
      let start = 179;
      vi.spyOn(dashboard, "getBoundingClientRect").mockImplementation(() => new DOMRect(42 + start - nav.scrollLeft, 0, 165, 60));
      vi.spyOn(conversation, "getBoundingClientRect").mockImplementation(() => new DOMRect(42 - nav.scrollLeft, 0, 179, 60));
      dashboard.focus(); fireEvent.click(dashboard);
      start = 168; nav.scrollLeft = 179; act(() => observed.get(nav)?.());
      expect(nav.scrollLeft).toBe(168); expect(dashboard).toHaveFocus();
      conversation.focus(); nav.scrollLeft = 179; act(() => observed.get(nav)?.());
      expect(nav.scrollLeft).toBe(0); expect(conversation).toHaveFocus();
      result.unmount(); expect(observed.size).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['dialog', 'menu'])('occluded sibling Canvas %s does not block ordinary foreground Escape', async role => {
    render(<><div className="canvas-node-card"><div role={role}>Older Canvas popup</div></div><Probe /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Exit fullscreen' }), { key: 'Escape' });
    expect(screen.queryByTestId('leader-fullscreen-overlay')).not.toBeInTheDocument();
    expect(screen.getByText('Older Canvas popup')).toBeInTheDocument();
  });

  it('foreground nested and body-level dialogs still block outer Escape, unlike inert background dialogs', () => {
    const view = render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    const cockpit = screen.getByTestId('leader-fullscreen-overlay');
    const nested = document.createElement('div'); nested.setAttribute('role', 'dialog'); cockpit.append(nested);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Exit fullscreen' }), { key: 'Escape' });
    expect(cockpit).toBeInTheDocument(); nested.remove();
    const global = document.createElement('div'); global.setAttribute('role', 'dialog'); document.body.append(global);
    try {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Exit fullscreen' }), { key: 'Escape' });
      expect(cockpit).toBeInTheDocument(); global.setAttribute('inert', '');
      fireEvent.keyDown(screen.getByRole('button', { name: 'Exit fullscreen' }), { key: 'Escape' });
      expect(screen.queryByTestId('leader-fullscreen-overlay')).not.toBeInTheDocument();
    } finally { global.remove(); view.unmount(); }
  });

  it("Cmd+Shift+F toggles the cockpit when the leader node owns focus", async () => {
    render(<Probe />);

    // The cockpit toggle is scoped to the leader's root by focus ownership.
    // Move focus onto the enter-fullscreen button (lives inside the node root)
    // so the keyboard shortcut applies.
    const enter = screen.getByRole("button", { name: "Enter fullscreen" });
    enter.focus();

    await act(async () => {
      fireEvent.keyDown(window, {
        key: "f",
        metaKey: true,
        shiftKey: true,
      });
    });
    expect(
      document.querySelector("[data-testid='leader-fullscreen-overlay']"),
    ).not.toBeNull();

    // Once the overlay is up the shortcut closes it from anywhere.
    await act(async () => {
      fireEvent.keyDown(window, {
        key: "f",
        metaKey: true,
        shiftKey: true,
      });
    });
    expect(
      document.querySelector("[data-testid='leader-fullscreen-overlay']"),
    ).toBeNull();
  });

  it("exit button closes the cockpit", async () => {
    render(<Probe />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });

    const exit = screen.getByTestId("leader-fullscreen-exit");
    expect(exit).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(exit);
    });
    expect(
      document.querySelector("[data-testid='leader-fullscreen-overlay']"),
    ).toBeNull();
  });

  it("renders the conversation header (status pill) and composer inside the cockpit", async () => {
    render(<Probe initial={{ taskName: "Build the cockpit", turns: 3 }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });

    const overlay = document.querySelector(
      "[data-testid='leader-fullscreen-overlay']",
    );
    // Title surfaces in the header.
    expect(overlay?.textContent).toContain("Build the cockpit");
    // Composer is mounted at the bottom of the conversation pane.
    expect(
      overlay?.querySelector(
        "[data-testid='leader-prompt-bar-inline']",
      ),
    ).not.toBeNull();
  });

  it("renders all five context-drawer tabs", async () => {
    render(<Probe initial={{ worktreeIsolation: true }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });

    for (const id of ["overview", "worktree", "approval", "skills", "prompt"]) {
      expect(screen.getByTestId(`drawer-tab-${id}`)).toBeInTheDocument();
    }
    // Default tab is "overview" since no approval is pending.
    expect(screen.getByTestId("drawer-panel-overview")).toBeInTheDocument();
  });

  it("activity rail renders a minion roster derived from taskPlan", async () => {
    render(
      <Probe
        initial={{
          taskPlan: [
            {
              taskId: "t1",
              title: "Investigate auth bug",
              description: "",
              priority: "high",
              status: "running",
              executor: "minion",
              minionSessionKey: "minion-alpha",
              result: null,
              cost: 0.012,
              createdAt: Date.now(),
              completedAt: null,
              sessionSummary: "",
              activeStep: "Reading auth.ts",
            },
            {
              taskId: "t2",
              title: "Self-review",
              description: "",
              priority: "low",
              status: "planned",
              executor: "leader",
              minionSessionKey: null,
              result: null,
              cost: 0,
              createdAt: Date.now(),
              completedAt: null,
              sessionSummary: "",
            },
          ],
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });

    const roster = screen.getByTestId("leader-fullscreen-minion-roster");
    // Only the minion-executor task shows up in the roster.
    expect(roster.textContent).toContain("Investigate auth bug");
    expect(roster.textContent).not.toContain("Self-review");
    // Active step appears for running minions.
    expect(roster.textContent).toContain("Reading auth.ts");
    // Click the row → fires reveal callback (no-op here, just verify the
    // testid was emitted from the row).
    expect(screen.getByTestId("minion-row-minion-alpha")).toBeInTheDocument();
  });

  it("renders both pane dividers and they can be activated via pointer-down", async () => {
    render(<Probe />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });

    const leftDivider = screen.getByTestId("leader-fullscreen-divider-left");
    const rightDivider = screen.getByTestId("leader-fullscreen-divider-right");
    expect(leftDivider).toHaveAttribute("role", "separator");
    expect(rightDivider).toHaveAttribute("role", "separator");

    // A pointer-down activates the drag without throwing — verifying the
    // pointer-capture path works in the test environment.
    await act(async () => {
      fireEvent.pointerDown(leftDivider, { clientX: 260, pointerId: 1 });
      fireEvent.pointerMove(leftDivider, { clientX: 320, pointerId: 1 });
      fireEvent.pointerUp(leftDivider, { clientX: 320, pointerId: 1 });
    });
  });

  it("Overview tab shows hero metrics and a task progress bar", async () => {
    render(
      <Probe
        initial={{
          turns: 5,
          totalCost: 0.0421,
          taskPlan: [
            {
              taskId: "a",
              title: "a",
              description: "",
              priority: "low",
              status: "completed",
              executor: "leader",
              minionSessionKey: null,
              result: null,
              cost: 0,
              createdAt: 0,
              completedAt: 1,
              sessionSummary: "",
            },
            {
              taskId: "b",
              title: "b",
              description: "",
              priority: "low",
              status: "running",
              executor: "leader",
              minionSessionKey: null,
              result: null,
              cost: 0,
              createdAt: 0,
              completedAt: null,
              sessionSummary: "",
            },
          ],
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });

    const panel = screen.getByTestId("drawer-panel-overview");
    // Hero metrics — cost is the dollar amount, turns is a number.
    expect(panel.textContent).toContain("$0.042");
    expect(panel.textContent).toContain("5");
    // Progress label shows done/total + per-turn cost hint.
    expect(panel.textContent).toContain("1/2");
    expect(panel.textContent).toContain("/turn");
  });

  it("auto-selects the Approval tab when an approval is pending", async () => {
    render(
      <Probe
        initial={{
          worktreeIsolation: true,
          approvalPending: true,
          approvalSummary: "ready to ship",
          approvalDiff: {
            filesChanged: 3,
            insertions: 42,
            deletions: 7,
            files: [],
            commits: ["abc1234"],
            branch: "feature/x",
          },
        }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });

    expect(screen.getByTestId("drawer-panel-approval")).toBeInTheDocument();
    expect(screen.getByTestId("drawer-panel-approval").textContent).toContain(
      "ready to ship",
    );
  });

  it("offers a Changes tab in live mode without treating stale approval as pending", async () => {
    render(<Probe initial={{ worktreeIsolation: false, approvalPending: true }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    });
    expect(screen.getByTestId("drawer-tab-approval")).toHaveTextContent("Workspace changes");
    expect(screen.getByTestId("drawer-panel-overview")).toBeInTheDocument();
  });
});

it("hydrates fullscreen dashboards independently of an unvisited canvas card", () => {
  requestLeaderFullscreen("leader-fs-test");
  render(<CanvasPresentationContext.Provider value={false}>
    <Probe initial={{ renderState: { layout: {}, components: [
      { id: "report", type: "text", content: "Fullscreen report from an offscreen card" },
    ] } }} />
  </CanvasPresentationContext.Provider>);
  const overlay = screen.getByTestId("leader-fullscreen-overlay");
  fireEvent.click(within(overlay).getByRole("button", { name: /^Dashboard$/ }));
  expect(within(overlay).getByText("Fullscreen report from an offscreen card")).toBeVisible();
});
