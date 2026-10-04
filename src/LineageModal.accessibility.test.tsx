import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { LineageModal } from "./LineageModal.tsx";
import type { WorktreeLineageSnapshot } from "../shared/worktree-integration.ts";
const lineage: WorktreeLineageSnapshot = { id: "accessible-lineage", projectId: "project", repositoryPath: "/fixture",
  baseSha: "b".repeat(40), integrationHeadSha: "c".repeat(40), integrationRef: "combined", integrationWorktreePath: "/fixture/integration",
  targetRef: "main", revision: 1, integrationState: "active", status: "open", memberships: [], resolutionRuns: [],
  contributions: [], queue: [], gates: [], reviews: [], createdAt: 1, updatedAt: 1 };
function Surface({ hideOpener = false, close = vi.fn() }: { hideOpener?: boolean; close?: () => void }) {
  const [open, setOpen] = useState(false);
  return <aside className="act-inspector">
    <div className="act-compact-navigation"><button>Conversation</button><button>Context</button></div>
    <button style={{ display: hideOpener ? "none" : undefined }} onClick={() => setOpen(true)}>Open lineage</button>
    {open && <LineageModal lineage={lineage} workItemId="work" allLineages={[lineage]} send={() => {}}
      onClose={() => { close(); setOpen(false); }} />}
  </aside>;
}
const open = () => { const button = screen.getByRole("button", { name: "Open lineage" }); button.focus(); fireEvent.click(button); return button; };
describe("approved U09 lineage modal boundary", () => {
  it("portals outside its host, names the modal and initially focuses Close", () => {
    const view = render(<Surface />); const opener = open();
    const dialog = screen.getByRole("dialog", { name: /Lineage accessible/ });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(view.container.contains(dialog)).toBe(false);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    expect(opener.closest("aside")?.parentElement).toHaveAttribute("inert");
  });
  it("contains forward/reverse Tab", () => {
    render(<Surface />); open();
    const dialog = screen.getByRole("dialog", { name: /Lineage accessible/ });
    const first = within(dialog).getByRole("button", { name: "+ New lineage" });
    const last = within(dialog).getByRole("button", { name: /Map to another lineage/ });
    last.focus(); fireEvent.keyDown(last, { key: "Tab" }); expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true }); expect(last).toHaveFocus();
  });
  it.each(["Escape", "Close", "backdrop"])("%s restores focus and existing inert state without reaching background shortcuts", method => {
    const shortcut = vi.fn(); window.addEventListener("keydown", shortcut);
    const prior = document.createElement("div"); prior.setAttribute("inert", ""); document.body.append(prior);
    const view = render(<Surface />); const opener = open();
    const close = screen.getByRole("button", { name: "Close" });
    if (method === "Escape") fireEvent.keyDown(close, { key: "Escape" });
    else fireEvent.click(method === "Close" ? close : document.querySelector(".lin-modal__backdrop")!);
    expect(screen.queryByRole("dialog")).toBeNull(); expect(opener).toHaveFocus();
    expect(view.container).not.toHaveAttribute("inert"); expect(prior).toHaveAttribute("inert");
    if (method === "Escape") expect(shortcut).not.toHaveBeenCalled();
    window.removeEventListener("keydown", shortcut); prior.remove();
  });
  it("returns to a visible Context navigation fallback when the opener hides", () => {
    const view = render(<Surface />); open(); view.rerender(<Surface hideOpener />);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Context" })).toHaveFocus();
  });
});
