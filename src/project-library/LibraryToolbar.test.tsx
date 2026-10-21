import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, summary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
afterEach(() => { vi.restoreAllMocks(); clearAuthToken(); sessionStorage.clear(); });

it("clears updates below the header without moving or replacing the registration draft", async () => {
  const b = libraryBoundary(); b.setSummaries([summary({ unread: 2 })]);
  render(<LibraryWorkspace onOpen={vi.fn()} registration={() => <input aria-label="Repository draft" />} />);
  const mark = await screen.findByRole("button", { name: "Mark all read" });
  const add = screen.getByRole("button", { name: "Add repository" });
  const row = add.parentElement!;
  expect(row).not.toContainElement(mark);
  fireEvent.click(add);
  const draft = screen.getByLabelText("Repository draft");
  fireEvent.change(draft, { target: { value: "/keep" } });
  fireEvent.click(mark);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark 2 read" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Unread updates" })).not.toBeInTheDocument());
  expect(add.parentElement).toBe(row); expect(screen.getByLabelText("Repository draft")).toBe(draft);
  expect(draft).toHaveValue("/keep"); expect(add).toHaveAttribute("aria-expanded", "true");
});

it("keeps search, filters and clear together with sorting beside the index", async () => {
  libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "Open Alpha" });
  const input = screen.getByLabelText("Search projects");
  fireEvent.change(input, { target: { value: "Alpha" } });
  const toolbar = input.closest(".pl-filters")!;
  for (const label of ["Collection", "Tag"]) expect(toolbar).toContainElement(screen.getByLabelText(label));
  expect(toolbar).not.toContainElement(screen.getByLabelText("Sort projects"));
  expect(screen.queryByRole("group", { name: "Project layout" })).not.toBeInTheDocument();
  expect(toolbar).toContainElement(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(screen.queryByRole("group", { name: "Active filters" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(input).toHaveValue("");
});
