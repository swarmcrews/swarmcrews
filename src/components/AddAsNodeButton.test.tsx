import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddAsNodeButton } from "./AddAsNodeButton.tsx";

afterEach(() => vi.useRealTimers());

describe("AddAsNodeButton", () => {
  it("does not render without an add action", () => {
    render(<AddAsNodeButton text="A finding" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("adds without submitting or bubbling, and exposes temporary feedback", () => {
    vi.useFakeTimers();
    const add = vi.fn();
    const submit = vi.fn();
    const parentClick = vi.fn();
    render(<form onSubmit={submit} onClick={parentClick}>
      <AddAsNodeButton text="A finding" onAdd={add} />
    </form>);
    const button = screen.getByRole("button", { name: "Add as node" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-feedback", "false");
    fireEvent.click(button);
    expect(add).toHaveBeenCalledWith("A finding");
    expect(submit).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute("data-feedback", "true");
    act(() => vi.runAllTimers());
    expect(button).toHaveAttribute("data-feedback", "false");
  });
});
