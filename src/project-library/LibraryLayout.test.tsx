import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, libraryProject, summary } from "./test-fixture.ts";

afterEach(() => { vi.restoreAllMocks(); clearAuthToken(); sessionStorage.clear(); });

it("groups add and tools with the title, keeps drafts outside the heading, and removes duplicate desk navigation", async () => {
  const onOpen = vi.fn();
  libraryBoundary({ projects: [libraryProject({ focusOrder: 0 })] });
  render(<LibraryWorkspace onOpen={onOpen} registration={() => <input aria-label="Repository draft" />} />);
  await screen.findByRole("button", { name: "Open Alpha" });
  const heading = screen.getByRole("heading", { name: "Project Library" }).closest("header")!;
  const add = within(heading).getByRole("button", { name: "Add repository" });
  expect(heading).toContainElement(screen.getByLabelText("Library tools"));
  expect(screen.queryByRole("button", { name: "Open desk" })).not.toBeInTheDocument();
  const pinned = screen.getByRole("region", { name: "Pinned projects" });
  fireEvent.click(within(pinned).getByRole("button", { name: "Alpha" }));
  expect(onOpen).toHaveBeenCalledOnce();
  fireEvent.click(add);
  const draft = screen.getByRole("textbox", { name: "Repository draft" });
  expect(heading).not.toContainElement(draft);
  fireEvent.change(draft, { target: { value: "/keep/draft" } });
  fireEvent.click(add); expect(draft).not.toBeVisible();
  fireEvent.click(add); expect(screen.getByLabelText("Repository draft")).toBe(draft);
  expect(draft).toHaveValue("/keep/draft");
});

it("keeps collections in tools and restores focus there after closing the dialog", async () => {
  libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "Open Alpha" });
  const tools = screen.getByLabelText("Library tools");
  expect(tools.parentElement).not.toHaveAttribute("open");
  expect(screen.getByRole("navigation", { name: "Project views" })).not.toContainElement(screen.getByText("Manage collections"));
  fireEvent.click(tools);
  fireEvent.click(screen.getByRole("button", { name: "Manage collections" }));
  const dialog = screen.getByRole("dialog", { name: "Collections" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(tools).toHaveFocus();
});

it("sorts beside the index even with no matches, with updates beside activity instead of an empty column", async () => {
  const b = libraryBoundary(); b.setSummaries([summary({ unread: 2 })]);
  render(<LibraryWorkspace onOpen={vi.fn()} />);
  const update = await screen.findByRole("button", { name: "2 new updates for Alpha" });
  const row = screen.getByRole("article", { name: "Alpha" });
  expect(row.querySelector(".pl-index-activity")).toContainElement(update);
  expect(document.querySelector(".pl-index-columns")).not.toHaveTextContent("Updates");
  const sort = screen.getByLabelText("Sort projects");
  expect(sort.closest(".pl-section-heading")).toContainElement(screen.getByRole("heading", { name: "All projects" }));
  fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "Missing" } });
  expect(screen.getByLabelText("Sort projects")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Matching projects" })).toBeVisible();
});
