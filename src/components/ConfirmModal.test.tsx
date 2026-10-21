import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmModal } from "./ConfirmModal.tsx";

describe("ConfirmModal keyboard safety", () => {
  it("preserves action labels, variants and callbacks", () => {
    const close = vi.fn();
    const proceed = vi.fn();
    const remove = vi.fn();
    const details = vi.fn();
    render(<ConfirmModal title="Choose an action" onClose={close} actions={[
      { label: "Proceed", onClick: proceed },
      { label: "Remove", variant: "danger", onClick: remove },
      { label: "Details", variant: "ghost", onClick: details },
    ]} />);
    for (const [name, callback] of [["Proceed", proceed], ["Remove", remove], ["Details", details], ["Cancel", close]] as const) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("type", "button");
      fireEvent.click(button);
      expect(callback).toHaveBeenCalledOnce();
    }
  });
  it("focuses Cancel, contains tab navigation and restores the opener", () => {
    const opener = document.createElement("button");
    opener.textContent = "Remove project";
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<ConfirmModal title="Remove project?" onClose={() => {}}
      actions={[{ label: "Remove", variant: "danger", onClick: () => {} }]} />);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const remove = screen.getByRole("button", { name: /^Remove$/ });
    expect(cancel).toHaveFocus();
    expect(opener).toHaveAttribute("inert");
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: "Tab" });
    expect(cancel).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    expect(opener).not.toHaveAttribute("inert");
    opener.remove();
  });

  it("keeps focus on rerender and isolates Escape from underlying shortcuts", () => {
    const close = vi.fn();
    const backgroundKey = vi.fn();
    window.addEventListener("keydown", backgroundKey);
    const props = { title: "Confirm", actions: [{ label: "Proceed", onClick: vi.fn() }] };
    const view = render(<ConfirmModal {...props} onClose={() => {}} />);
    screen.getByRole("button", { name: "Proceed" }).focus();
    view.rerender(<ConfirmModal {...props} onClose={close} />);
    expect(screen.getByRole("button", { name: "Proceed" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("button", { name: "Proceed" }), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    expect(backgroundKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", backgroundKey);
  });
});
