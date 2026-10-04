import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphInspector } from "./GraphInspector.tsx";
import { createGraphFixture } from "./fixtures.ts";

const key = "swarmcrews:graph-inspector-phone-view";
const props = () => ({ snapshot: createGraphFixture(10), onClose: vi.fn(), onAction: vi.fn() });
beforeEach(() => { localStorage.removeItem(key); });
afterEach(() => { localStorage.removeItem(key); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function width(value: number) { vi.stubGlobal("innerWidth", value); }

describe("phone graph operator lens", () => {
  it("opens the task queue on phones without a preference and retains Flow", () => {
    width(390);
    render(<GraphInspector {...props()} />);
    expect(screen.getByRole("tab", { name: "Work queue" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: "Windowed work queue" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Task 1/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Task 1/ })).toHaveTextContent("Attempt queued");
    expect(screen.getByRole("tab", { name: "Flow" })).toBeInTheDocument();
  });

  it("remembers an explicit phone lens across reopen without changing desktop defaults", () => {
    width(320);
    const first = render(<GraphInspector {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Flow" }));
    first.unmount();
    const reopened = render(<GraphInspector {...props()} />);
    expect(screen.getByRole("tab", { name: "Flow" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Work queue" }));
    reopened.unmount();
    width(1440);
    render(<GraphInspector {...props()} />);
    expect(screen.getByRole("tab", { name: "Flow" })).toHaveAttribute("aria-selected", "true");
  });

  it("honors deep-link lens overrides and ignores invalid stored values", () => {
    width(390);
    localStorage.setItem(key, "obsolete-view");
    const first = render(<GraphInspector {...props()} />);
    expect(screen.getByRole("tab", { name: "Work queue" })).toHaveAttribute("aria-selected", "true");
    first.unmount();
    render(<GraphInspector {...props()} initialTab="evidence" />);
    expect(screen.getByRole("tab", { name: "Context lineage" })).toHaveAttribute("aria-selected", "true");
    expect(localStorage.getItem(key)).toBe("obsolete-view");
  });

  it("uses the operator lens even when preference storage is unavailable", () => {
    width(320);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
    render(<GraphInspector {...props()} />);
    expect(screen.getByRole("tab", { name: "Work queue" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Work queue" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Flow" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("run cancellation confirmation", () => {
  it("does not dispatch on dismissal and confirms the identified run before fenced dispatch", () => {
    width(320);
    const input = props();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<GraphInspector {...input} createRequestId={() => "confirmed-request"} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(input.snapshot.title));
    expect(input.onAction).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(input.onAction).toHaveBeenCalledWith(expect.objectContaining({
      type: "cancel_run", graphRunId: input.snapshot.graphRunId,
      expectedRunRevision: input.snapshot.revision, requestId: "confirmed-request",
    }));
  });

  it("does not ask or dispatch when controls are unavailable", () => {
    const input = props();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<GraphInspector {...input} controlsEnabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(input.onAction).not.toHaveBeenCalled();
  });
});
