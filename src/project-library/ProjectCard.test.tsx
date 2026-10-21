import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectCard } from "./ProjectCard.tsx";
import { libraryProject, summary } from "./test-fixture.ts";

function mount(overrides: Parameters<typeof summary>[0] = {}, archived = false) {
  const callbacks = { onOpen: vi.fn(), onDetails: vi.fn(), onActivity: vi.fn(), onUpdates: vi.fn() };
  const props = { project: libraryProject({ archived }), summary: summary(overrides), now: Date.now(), ...callbacks };
  return { ...render(<ProjectCard {...props} />), ...callbacks, props };
}

describe("Content-first project cards", () => {
  it("does not label waiting or blocked work Running when execution is false", () => {
    const view = mount({ state: "attention", activeWorkItems: 3, activeLeaders: 2, activeOther: 1, running: false, runningLeaders: 0, unread: 1 });
    expect(screen.queryByRole("button", { name: "Running" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting" })).toBeVisible();
    view.rerender(<ProjectCard {...view.props} summary={summary({ state: "running", activeWorkItems: 1, running: false, unread: 0 })} />);
    expect(screen.getByRole("button", { name: "Waiting" })).toBeVisible();
  });

  it("shows only executing leaders when running work coexists with waiting leaders", () => {
    mount({ state: "attention", activeLeaders: 3, runningLeaders: 1, activeCrew: 2, running: true });
    expect(screen.getByRole("button", { name: "Running" })).toHaveAccessibleDescription("1 active leader · 2 active crew");
  });

  it("keeps explicitly unknown execution distinct from older responses without execution fields", () => {
    const view = mount({ state: "running", running: null, activeWorkItems: 1 });
    expect(screen.queryByRole("button", { name: "Running" })).not.toBeInTheDocument();
    view.rerender(<ProjectCard {...view.props} summary={summary({ state: "attention", running: true, runningLeaders: null, activeLeaders: 3, activeCrew: 2 })} />);
    expect(screen.getByRole("button", { name: "Running" })).toHaveAccessibleDescription("2 active crew");
  });

  it("keeps quiet cards to identity and details while metadata remains accessible", () => {
    const actions = mount();
    const card = screen.getByRole("article", { name: "Alpha" });
    expect(within(card).getAllByRole("button")).toHaveLength(2);
    expect(card.querySelector(".pl-state, footer, .pl-recent-row, .pl-card-agents, .pl-path, .pl-card-metadata")).toBeNull();
    const open = within(card).getByRole("button", { name: "Open Alpha" });
    expect(open).toHaveAttribute("title", "/repo/alpha");
    fireEvent.click(open);
    fireEvent.click(within(card).getByRole("button", { name: "Details and organization for Alpha" }));
    expect(actions.onOpen).toHaveBeenCalledOnce();
    expect(actions.onDetails).toHaveBeenCalledOnce();
    expect(actions.onActivity).not.toHaveBeenCalled();
    expect(actions.onUpdates).not.toHaveBeenCalled();
  });

  it("keeps the whole-card open action separate from status, details and unread actions", () => {
    const actions = mount({ state: "running", activeLeaders: 2, activeCrew: 3, unread: 4 });
    const card = screen.getByRole("article", { name: "Alpha" });
    const open = within(card).getByRole("button", { name: "Open Alpha" });
    expect(open.closest("h3")).not.toBeNull();
    expect(open.querySelector("button, a, input, select, [tabindex]")).toBeNull();
    const activity = within(card).getByRole("button", { name: "Running" });
    expect(activity).toHaveAccessibleDescription("2 active leaders · 3 active crew");
    expect(within(activity).getByText("Running")).not.toHaveClass("pl-sr-only");
    expect(card.querySelector("header")?.firstElementChild).toContainElement(open);
    for (const control of within(card).getAllByRole("button").filter(button => button !== open)) expect(open.contains(control)).toBe(false);
    fireEvent.click(activity);
    fireEvent.click(within(card).getByRole("button", { name: "4 new updates for Alpha" }));
    expect(actions.onActivity).toHaveBeenCalledOnce();
    expect(actions.onUpdates).toHaveBeenCalledOnce();
    expect(actions.onOpen).not.toHaveBeenCalled();
  });

  it.each(["attention", "new", "up_to_date", "unknown"] as const)("keeps unread actions distinct from attention and unknown %s status", state => {
    const actions = mount({ state, unread: 3, attention: { total: 2, decision: 1, review: 1, conflict: 0 } });
    const card = screen.getByRole("article", { name: "Alpha" });
    if (state === "unknown") expect(within(card).getByText("Status unavailable")).toBeVisible();
    else {
      const attention = within(card).getByRole("button", { name: "Needs attention" });
      expect(attention).toHaveTextContent("1 decision · 1 review");
      fireEvent.click(attention); expect(actions.onActivity).toHaveBeenCalledOnce();
    }
    const unread = within(card).getByRole("button", { name: "3 new updates for Alpha" });
    expect(unread).toHaveTextContent("View 3 updates");
    fireEvent.click(unread); expect(actions.onUpdates).toHaveBeenCalledOnce();
    expect(actions.onOpen).not.toHaveBeenCalled();
  });

  it.each(["attention", "new", "up_to_date", "unknown"] as const)("does not leave a status message for %s with no unread updates or active work", state => {
    const { container } = mount({ state, unread: 0 });
    expect(container.querySelector(".pl-state, footer, .pl-recent-row")).toBeNull();
  });

  it.each([{ activeLeaders: 1 }, { activeCrew: 2 }, { activeOther: 1 }, { activeWorkItems: 1 }])("shows Running when attention coexists with current active work (%j)", activity => {
    mount({ state: "attention", ...activity, running: true, attention: { total: 2, decision: 1, review: 1, conflict: 0 } });
    expect(screen.getByRole("button", { name: "Running" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Needs attention" })).toBeVisible();
  });

  it.each([
    { freshness: "unknown" as const },
    { expiresAt: "2000-01-01T00:00:00Z" },
    { projectId: "another-project" },
  ])("suppresses current status and unread actions for unavailable, expired or foreign summaries (%j)", invalid => {
    const { container } = mount({ state: "running", activeLeaders: 2, activeCrew: 3, unread: 4, ...invalid });
    expect(container.querySelector(".pl-state, .pl-card-agents, footer")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("does not invent active work from an unknown runtime state", () => {
    mount({ state: "unknown", activeLeaders: 2 });
    expect(screen.queryByRole("button", { name: "Running" })).not.toBeInTheDocument();
  });

  it("keeps archived cards free of runtime and unread signals", () => {
    const { container } = mount({ state: "running", activeLeaders: 2, unread: 3 }, true);
    expect(container.querySelector(".pl-state, .pl-card-agents, footer")).toBeNull();
  });

  it("removes the update action and label after marking read, keeping Running until work stops", () => {
    const view = mount({ state: "running", activeLeaders: 1, unread: 2 });
    view.rerender(<ProjectCard {...view.props} summary={summary({ state: "running", activeLeaders: 1, unread: 0 })} />);
    expect(screen.getByRole("button", { name: "Running" })).toBeVisible();
    expect(view.container.querySelector("footer")).toBeNull();
    view.rerender(<ProjectCard {...view.props} summary={summary({ state: "new", unread: 0 })} />);
    expect(view.container.querySelector(".pl-state, .pl-card-agents, footer")).toBeNull();
  });

  it("removes live indicators when the shared refresh clock expires", () => {
    const view = mount({ state: "running", activeLeaders: 1, unread: 2 });
    view.rerender(<ProjectCard {...view.props} now={Date.parse(view.props.summary.expiresAt) + 1} />);
    expect(view.container.querySelector(".pl-state, .pl-card-agents, footer")).toBeNull();
  });

  it("previews only this project's unread event, with no read-history or empty placeholders", () => {
    const recent = { id: "event-alpha", revision: 1, projectId: "alpha", workItemId: null, kind: "context" as const, text: "Export plan updated", at: Date.now() - 120000, unread: true, destination: { view: "context" as const } };
    const view = mount({ state: "new", unread: 1, recent });
    expect(screen.getByText(recent.text)).toHaveAttribute("title", recent.text);
    expect(screen.getByText("2m ago")).toHaveAttribute("dateTime", new Date(recent.at).toISOString());
    expect(screen.getByRole("button", { name: "1 new updates for Alpha" })).toHaveTextContent("View 1 update");
    for (const override of [{ unread: false }, { projectId: "foreign" }]) {
      view.rerender(<ProjectCard {...view.props} summary={summary({ state: "new", unread: 1, recent: { ...recent, ...override } })} />);
      expect(screen.queryByText(recent.text)).not.toBeInTheDocument();
      expect(view.container.querySelector("time")).toBeNull();
    }
  });
});

it("distinguishes unavailable/expired status from a genuinely quiet card", () => {
  const view = mount({ freshness: "unknown", state: "running", running: true });
  expect(screen.getByText("Status unavailable")).toBeVisible();
  view.rerender(<ProjectCard {...view.props} summary={summary({ expiresAt: "2000-01-01T00:00:00Z" })} />);
  expect(screen.getByText("Status unavailable")).toBeVisible();
  view.rerender(<ProjectCard {...view.props} summary={summary()} />);
  expect(screen.queryByText(/Status unavailable|Refreshing status/)).not.toBeInTheDocument();
});

it("labels archived identity as details and omits dates that were never recorded", () => {
  const onDetails = vi.fn(), onOpen = vi.fn(), onRestore = vi.fn();
  render(<ProjectCard project={libraryProject({ archived: true, lastOpened: null })} now={Date.now()} {...{ onDetails, onOpen, onRestore }} onActivity={vi.fn()} onUpdates={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "View details for Alpha" }));
  expect(onDetails).toHaveBeenCalledOnce(); expect(onOpen).not.toHaveBeenCalled();
  expect(screen.queryByText(/Last opened|Archived on/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore Alpha to Library" }));
  expect(onRestore).toHaveBeenCalledOnce(); expect(onDetails).toHaveBeenCalledTimes(1);
});
