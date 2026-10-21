import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, libraryProject } from "./test-fixture.ts";

describe("Library presentation preserves organization and accessible actions", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => { sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });

  it("counts the current filtered set and view without treating it as the entire Library", async () => {
    libraryBoundary({ projects: [libraryProject(), libraryProject({ id: "beta", name: "Beta", path: "/repo/beta", focusOrder: 0 }), libraryProject({ id: "old", name: "Old", path: "/repo/old", archived: true })] });
    render(<LibraryWorkspace onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    expect(screen.getByText("2 projects in Library")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "Alpha" } });
    expect(screen.getByText("1 project in Library")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "Absent" } });
    expect(screen.queryByText(/projects? in Library/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    const nav = screen.getByRole("navigation", { name: "Project views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Focus desk" }));
    expect(screen.getByText("1 project on your desk")).toBeVisible();
    fireEvent.click(within(nav).getByRole("button", { name: "Archived" }));
    expect(screen.getByText("1 project archived")).toBeVisible();
  });

  it("decorative icons do not change control names, selected state or commit affordances", async () => {
    libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: "Open Alpha" });
    const nav = screen.getByRole("navigation", { name: "Project views" });
    expect(within(nav).getByRole("button", { name: "Library" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Library tools"));
    expect(screen.getByRole("button", { name: "Refresh Library" })).toBeEnabled();
    expect(screen.queryByRole("group", { name: "Project layout" })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Alpha" })).toHaveClass("pl-index-row");
    fireEvent.click(screen.getByRole("button", { name: "Details and organization for Alpha" }));
    const dialog = screen.getByRole("dialog", { name: "Alpha" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Preserved description" } });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toHaveClass("pl-action--primary");
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).not.toHaveClass("pl-action--primary");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(within(dialog).getByRole("textbox", { name: "Description" })).toHaveValue("Preserved description");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard and close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
