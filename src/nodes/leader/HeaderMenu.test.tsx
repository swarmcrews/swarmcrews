/**
 * Component test for HeaderMenu — the ⋮ kebab in the leader-card header.
 *
 * Focus: the "Open System Model" action added so a leader can spawn a
 * System Model node preloaded with its own session key.
 *   - The item appears only when a session key exists and a handler is wired.
 *   - Clicking it fires onOpenSystemModel and closes the menu.
 *   - It is hidden when the leader has no session key yet.
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HeaderMenu } from "./HeaderMenu.tsx";
import { LEADER_DEFAULT_DATA, type LeaderData } from "./types.ts";

function dataWith(overrides: Partial<LeaderData>): LeaderData {
  return { ...LEADER_DEFAULT_DATA, ...overrides };
}

const noop = () => {};

describe("HeaderMenu — Open System Model", () => {
  it("keeps wheel scrolling inside the menu and still dismisses on outside scroll", () => {
    render(<HeaderMenu onReset={noop} onExportLog={noop} data={dataWith({})} />);
    fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
    const item = screen.getByRole("menuitem", { name: /export log/i });
    const outsideWheel = vi.fn();
    window.addEventListener("wheel", outsideWheel);
    try {
      for (const deltaY of [100, -100]) {
        expect(fireEvent.wheel(item, { deltaY })).toBe(true);
        expect(screen.getByRole("menu", { name: /leader actions/i })).toBeInTheDocument();
      }
      expect(outsideWheel).not.toHaveBeenCalled();
      fireEvent.wheel(document.body, { deltaY: 100 });
      expect(screen.queryByRole("menu", { name: /leader actions/i })).toBeNull();
    } finally {
      window.removeEventListener("wheel", outsideWheel);
    }
  });

  it("opens a System Model node preloaded with the session and closes the menu", () => {
    const onOpenSystemModel = vi.fn();
    render(
      <HeaderMenu
        onReset={noop}
        onExportLog={noop}
        onOpenSystemModel={onOpenSystemModel}
        data={dataWith({ sessionKey: "leader-1", status: "idle" })}
      />,
    );

    // Menu starts closed.
    expect(screen.queryByRole("button", { name: /open system model/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
    const item = screen.getByRole("menuitem", { name: /open system model/i });
    fireEvent.click(item);

    expect(onOpenSystemModel).toHaveBeenCalledTimes(1);
    // Menu closed again after the action.
    expect(screen.queryByRole("menuitem", { name: /open system model/i })).toBeNull();
  });

  it("hides the action when the leader has no session key", () => {
    render(
      <HeaderMenu
        onReset={noop}
        onExportLog={noop}
        onOpenSystemModel={vi.fn()}
        data={dataWith({ sessionKey: null })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
    expect(screen.queryByRole("menuitem", { name: /open system model/i })).toBeNull();
  });

  it("hides the action when no handler is provided", () => {
    render(
      <HeaderMenu
        onReset={noop}
        onExportLog={noop}
        data={dataWith({ sessionKey: "leader-1" })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
    expect(screen.queryByRole("menuitem", { name: /open system model/i })).toBeNull();
  });

  it("consumes its first Escape before the outer window listener, then releases ordinary Escape", async () => {
    render(<HeaderMenu onReset={noop} onExportLog={noop} data={dataWith({})} />);
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      const trigger = screen.getByRole("button", { name: /more leader actions/i });
      fireEvent.click(trigger);
      const item = screen.getByRole("menuitem", { name: /export log/i });
      await waitFor(() => expect(item).toHaveFocus());
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => { item.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
      expect(outer).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu", { name: /leader actions/i })).toBeNull();
      await waitFor(() => expect(trigger).toHaveFocus());
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(outer).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("keydown", outer); }
  });

  it.each(["dialog", "menu"])("does not steal Escape from another foreground %s", async role => {
    render(<HeaderMenu onReset={noop} onExportLog={noop} data={dataWith({})} />);
    fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /export log/i })).toHaveFocus());
    const surface = document.createElement("div");
    surface.setAttribute("role", role);
    const input = document.createElement("input"); surface.append(input); document.body.append(surface);
    try {
      input.focus();
      const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      act(() => { input.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
      expect(screen.getByRole("menu", { name: /leader actions/i })).toBeInTheDocument();
      expect(input).toHaveFocus();
    } finally { surface.remove(); }
  });

  it.each(["hidden", "inert"])("retires the portal without consuming Escape when its trigger owner becomes %s", async attribute => {
    render(<section data-testid="owner"><HeaderMenu onReset={noop} onExportLog={noop} data={dataWith({})} /></section>);
    fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /export log/i })).toHaveFocus());
    screen.getByTestId("owner").setAttribute(attribute, "");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    await waitFor(() => expect(screen.queryByRole("menu", { name: /leader actions/i })).toBeNull());
  });

  it("retires a Canvas portal on cockpit entry without stealing focus or invoking preset actions", async () => {
    const save = vi.fn();
    render(<section className="leader-node"><HeaderMenu onReset={noop} onExportLog={noop}
      onSavePreset={save} data={dataWith({})} /></section>);
    const trigger = screen.getByRole("button", { name: /more leader actions/i });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /save as preset/i })).toHaveFocus());
    fireEvent.click(screen.getByRole("menuitem", { name: /save as preset/i }));
    fireEvent.change(screen.getByPlaceholderText("My leader preset"), { target: { value: "Unsent café Ω" } });
    const cockpit = document.createElement("div"); cockpit.className = "leader-fullscreen-overlay";
    cockpit.setAttribute("role", "dialog");
    const foreground = document.createElement("button"); cockpit.append(foreground);
    document.body.append(cockpit); foreground.focus();
    try {
      await waitFor(() => expect(screen.queryByRole("menu", { name: /leader actions/i })).toBeNull());
      expect(foreground).toHaveFocus(); expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(save).not.toHaveBeenCalled();
    } finally { cockpit.remove(); }
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem", { name: /save as preset/i }));
    expect(screen.getByPlaceholderText("My leader preset")).toHaveValue("Unsent café Ω");
  });

  it("an earlier menu leaves a later foreground menu's Escape and focus to its owner", async () => {
    render(<><section data-testid="older"><HeaderMenu onReset={noop} onExportLog={noop} data={dataWith({})} /></section>
      <section data-testid="newer"><HeaderMenu onReset={noop} onExportLog={noop} data={dataWith({})} /></section></>);
    const older = within(screen.getByTestId("older")).getByRole("button", { name: /more leader actions/i });
    const newer = within(screen.getByTestId("newer")).getByRole("button", { name: /more leader actions/i });
    fireEvent.click(older); fireEvent.click(newer);
    const lastItem = screen.getAllByRole("menuitem", { name: /export log/i })[1]!;
    await waitFor(() => expect(lastItem).toHaveFocus());
    fireEvent.keyDown(lastItem, { key: "Escape" });
    expect(older).toHaveAttribute("aria-expanded", "true");
    expect(newer).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(newer).toHaveFocus());
  });

  it("focuses the first item only after the owned portal is visible, without waiting for an animation frame", () => {
    const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      render(<HeaderMenu onReset={noop} onExportLog={noop} data={dataWith({})} />);
      fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
      const menu = screen.getByRole("menu", { name: /leader actions/i });
      expect(menu.style.visibility).toBe("visible");
      expect(screen.getByRole("menuitem", { name: /export log/i })).toHaveFocus();
      expect(focus).toHaveBeenCalled();
    } finally { frame.mockRestore(); focus.mockRestore(); }
  });

  it("live portal positioning does not steal focus from unsent preset input", () => {
    render(<HeaderMenu onReset={noop} onExportLog={noop} onSavePreset={() => true} data={dataWith({})} />);
    fireEvent.click(screen.getByRole("button", { name: /more leader actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /save as preset/i }));
    const name = screen.getByPlaceholderText("My leader preset");
    fireEvent.change(name, { target: { value: "Unsent café Ω  " } });
    expect(name).toHaveFocus(); fireEvent(window, new Event("resize"));
    expect(name).toHaveFocus(); expect(name).toHaveValue("Unsent café Ω  ");
  });

  it("focuses the menu and returns focus to the trigger on Escape", async () => {
    render(
      <HeaderMenu
        onReset={() => {}}
        onExportLog={() => {}}
        data={dataWith({})}
      />,
    );

    const trigger = screen.getByRole("button", { name: /more leader actions/i });
    fireEvent.click(trigger);

    const firstItem = await screen.findByRole("menuitem", { name: /export log/i });
    await waitFor(() => expect(firstItem).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: /leader actions/i })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
