import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { CollectionsDialog } from "./CollectionsDialog.tsx";
import { ProjectUpdates } from "./ProjectUpdates.tsx";
import { boundaryResponse, libraryBoundary, libraryProject, summary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); clearAuthToken(); sessionStorage.clear(); });
const open = async () => fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" }));

it("keeps a pending collection creation guarded and restores the picker focus", async () => {
  const b = libraryBoundary(); const base = b.fetch.getMockImplementation()!;
  let resolve!: (response: Response) => void;
  b.fetch.mockImplementation(async (url, options) => String(url).endsWith("/collections") && options?.method === "POST" ? new Promise<Response>(r => { resolve = r; }) : base(url, options));
  render(<LibraryWorkspace onOpen={vi.fn()} />); await open();
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Draft stays here" } });
  const input = screen.getByLabelText("Find or create collection");
  fireEvent.change(input, { target: { value: "Team" } });
  fireEvent.click(screen.getByRole("button", { name: "Create collection Team" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => resolve(boundaryResponse({ id: "team", name: "Team" })));
  expect(input).toHaveFocus();
  expect(screen.getByRole("checkbox", { name: "Team" })).toBeChecked();
  expect(screen.getByLabelText("Description")).toHaveValue("Draft stays here");
});

it("does not consume IME composition as a tag commit, and preserves selected collections while searching", async () => {
  libraryBoundary({ projects: [libraryProject({ collectionIds: ["a"] })], collections: [{ id: "a", name: "Alpha group" }, { id: "b", name: "Beta group" }] });
  render(<LibraryWorkspace onOpen={vi.fn()} />); await open();
  const input = screen.getByLabelText("Add tag");
  fireEvent.change(input, { target: { value: "設計" } });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(input).toHaveValue("設計"); expect(screen.queryByRole("button", { name: "Remove tag 設計" })).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("button", { name: "Remove tag 設計" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Find or create collection"), { target: { value: "Beta" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta group" }));
  fireEvent.change(screen.getByLabelText("Find or create collection"), { target: { value: "" } });
  expect(screen.getByRole("checkbox", { name: "Alpha group" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Beta group" })).toBeChecked();
});

it("renames a collection in its own row and transfers focus to its editor", () => {
  render(<CollectionsDialog collections={[{ id: "a", name: "Team" }]} onChanged={async () => true} onClose={vi.fn()} />);
  const row = screen.getByRole("button", { name: "Rename Team" }).closest(".pl-collection-row")!;
  fireEvent.click(screen.getByRole("button", { name: "Rename Team" }));
  expect(within(row as HTMLElement).getByLabelText("Collection name")).toHaveFocus();
  expect(screen.queryByLabelText("New collection name")).not.toBeInTheDocument();
});

it("discloses maintenance on demand, supports Escape, and restores focus after cleanup", async () => {
  libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />);
  await screen.findByRole("button", { name: "Open Alpha" });
  const tools = screen.getByLabelText("Library tools");
  expect(screen.getByRole("button", { name: "Refresh Library" })).not.toBeVisible();
  fireEvent.click(tools);
  expect(screen.getByRole("button", { name: "Refresh Library" })).toBeVisible();
  fireEvent.keyDown(tools, { key: "Escape" });
  expect(tools).toHaveFocus(); expect(tools.parentElement).not.toHaveAttribute("open");
  fireEvent.click(tools); fireEvent.click(screen.getByRole("button", { name: "Clean up missing folders" }));
  await screen.findByRole("dialog", { name: "Clean up missing folders" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(tools).toHaveFocus();
});

it("does not present expired runtime counts as current in the updates sheet", async () => {
  libraryBoundary(); const now = Date.now();
  render(<ProjectUpdates project={libraryProject()} summary={summary({ expiresAt: new Date(now - 1).toISOString(), activeLeaders: 7 })} now={now} onClose={vi.fn()} onRead={vi.fn()} onOpen={vi.fn()} />);
  await screen.findByText("Result ready");
  expect(screen.getByText("Active leaders").nextElementSibling).toHaveTextContent("—");
  expect(screen.getByText(/Live status unavailable/)).toBeVisible();
});

it("returns Keep editing to the same draft field and insertion point", async () => {
  libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />); await open();
  const field = screen.getByLabelText("Description") as HTMLTextAreaElement;
  field.focus(); fireEvent.change(field, { target: { value: "A draft with a caret" } });
  field.setSelectionRange(4, 4);
  const close = screen.getByRole("button", { name: "Close" }); close.focus(); fireEvent.click(close);
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(field).toHaveFocus(); expect(field.selectionStart).toBe(4); expect(field.selectionEnd).toBe(4);
});

it("retains the rename editor when its collection disappears during a refresh", () => {
  const props = { onChanged: async () => true, onClose: vi.fn() };
  const view = render(<CollectionsDialog {...props} collections={[{ id: "a", name: "Team" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rename Team" }));
  fireEvent.change(screen.getByLabelText("Collection name"), { target: { value: "Still my draft" } });
  view.rerender(<CollectionsDialog {...props} collections={[]} />);
  expect(screen.getByLabelText("Collection name")).toHaveValue("Still my draft");
  expect(screen.getByRole("button", { name: "Save collection name" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.getByLabelText("New collection name")).toHaveValue("");
});
