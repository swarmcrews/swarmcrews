import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsTutorial } from "./ProjectsTutorial.tsx";

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
});

function click(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
function source() { return within(screen.getByRole("region", { name: "Design the welcome page" })); }
function target() { return within(screen.getByRole("region", { name: "Build the welcome page" })); }
function sendBrief() {
  fireEvent.change(source().getByRole("textbox", { name: "Leader prompt" }), { target: { value: "Create a welcome page design brief" } });
  fireEvent.keyDown(source().getByRole("textbox", { name: "Leader prompt" }), { key: "Enter" });
}
function beginConnection() {
  const port = source().getByRole("group", { name: "Share context output" });
  expect(port.querySelector(".canvas-port__fins")).toBeInTheDocument();
  fireEvent.mouseDown(port, { clientX: 400, clientY: 255 });
}
function openConnectionStep() {
  render(<ProjectsTutorial prominent />);
  click("Start tutorial");
  sendBrief();
  click("Next objective");
}
function dropOnEmptyCanvas() {
  beginConnection();
  fireEvent.mouseMove(window, { clientX: 640, clientY: 200 });
  expect(screen.getByLabelText("Connection preview")).toBeInTheDocument();
  fireEvent.mouseUp(window, { clientX: 640, clientY: 200 });
  expect(screen.getByText("Use dashboard context")).toBeInTheDocument();
}

describe("Projects tutorial", () => {
  it("follows the actual prompt, output drag, context menu, and leader-authored plan workflow", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ProjectsTutorial prominent />);
    click("Start tutorial");
    expect(screen.getByRole("heading", { name: "Brief your leader" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Next objective" })).toBeDisabled();
    expect(source().getByRole("button", { name: "Start" })).toBeDisabled();
    sendBrief();
    expect(source().getByRole("tab", { name: "Dashboard" })).toBeInTheDocument();
    click("Next objective");
    expect(source().getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
    dropOnEmptyCanvas();
    expect(screen.getByRole("button", { name: "Lean" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full" })).toBeInTheDocument();
    click("Dashboard");
    expect(target().getByText(/Connected context: Dashboard/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection preview")).not.toBeInTheDocument();
    click("Next objective");
    expect(screen.queryByRole("region", { name: /Execution plan/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next objective" })).toBeDisabled();
    const prompt = target().getByRole("textbox", { name: "Leader prompt" });
    fireEvent.change(prompt, { target: { value: "Hello" } });
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(target().getByRole("status")).toHaveTextContent("ask the leader to build a task graph");
    expect(screen.getByRole("button", { name: "Next objective" })).toBeDisabled();
    fireEvent.change(prompt, { target: { value: "Build a task graph to implement the welcome page and verify accessibility." } });
    fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
    expect(screen.queryByRole("region", { name: /Execution plan/ })).not.toBeInTheDocument();
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(target().getByRole("region", { name: /Execution plan/ })).toBeInTheDocument();
    expect(target().getByRole("group", { name: "Context input (locked)" })).toBeInTheDocument();
    click("Next objective");
    click("Details");
    const details = screen.getByRole("dialog", { name: /Execution plan:/ });
    expect(within(details).getByText("Verify accessibility")).toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: "Close" }));
    click("Adjust");
    expect(prompt).toHaveFocus();
    fireEvent.change(prompt, { target: { value: "Also verify the layout on mobile" } });
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(target().getByText("Revision 2")).toBeInTheDocument();
    click("Details");
    expect(within(screen.getByRole("dialog", { name: /Execution plan:/ })).getByText("Also verify the layout on mobile")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: /Execution plan:/ })).getByRole("button", { name: "Close" }));
    const proposal = target().getByRole("region", { name: /Execution plan/ });
    fireEvent.click(within(proposal).getByRole("button", { name: "Start" }));
    expect(target().getByText(/Practice run complete/)).toBeInTheDocument();
    click("Finish mission");
    expect(screen.getByRole("heading", { name: "You’re ready to lead." })).toHaveFocus();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "4");
    click("Play again");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
    expect(source().getByRole("textbox", { name: "Leader prompt" })).toHaveValue("");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("supports adding a leader and snapping the output to its context input, while rejecting invalid drops", () => {
    openConnectionStep();
    fireEvent.contextMenu(screen.getByRole("group", { name: "Empty canvas drop area" }), { clientX: 640, clientY: 200 });
    click("Leader");
    expect(screen.getByRole("button", { name: "Next objective" })).toBeDisabled();
    beginConnection();
    fireEvent.mouseUp(window, { clientX: 600, clientY: 200 });
    expect(screen.queryByText("Use dashboard context")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next objective" })).toBeDisabled();
    beginConnection();
    fireEvent.mouseMove(window, { clientX: 532, clientY: 448 });
    expect(target().getByRole("group", { name: "Context input" })).toHaveAttribute("data-state", "snap");
    fireEvent.mouseUp(target().getByRole("group", { name: "Context input" }));
    expect(screen.getByRole("button", { name: "Next objective" })).toBeEnabled();
    expect(target().getByText(/Connected context: Dashboard/)).toBeInTheDocument();
  });

  it("allows keyboard connection and cancels a pointer drag without completing the objective", () => {
    openConnectionStep();
    beginConnection();
    fireEvent.pointerCancel(window);
    expect(screen.queryByLabelText("Connection preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next objective" })).toBeDisabled();
    fireEvent.keyDown(source().getByRole("group", { name: "Share context output" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("group", { name: "Empty canvas drop area" }), { key: "Enter" });
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Dashboard" }), { key: "Escape" });
    expect(screen.queryByText("Use dashboard context")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Drag to connect" })).toBeInTheDocument();
    expect(source().getByRole("group", { name: "Share context output" })).toHaveFocus();
    fireEvent.keyDown(source().getByRole("group", { name: "Share context output" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("group", { name: "Empty canvas drop area" }), { key: "Enter" });
    click("Lean");
    expect(target().getByText(/Connected context: Lean/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next objective" })).toBeEnabled();
  });

  it("exits with Escape, restores trigger focus, and restarts when reopened", () => {
    render(<ProjectsTutorial />);
    const trigger = screen.getByRole("button", { name: "Tutorial" });
    trigger.focus();
    fireEvent.click(trigger);
    sendBrief();
    click("Next objective");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Brief your leader" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "0");
    click("Exit tutorial");
    expect(trigger).toHaveFocus();
  });
});
