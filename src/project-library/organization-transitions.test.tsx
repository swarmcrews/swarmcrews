import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { CollectionsDialog } from "./CollectionsDialog.tsx";
import { libraryBoundary } from "./test-fixture.ts";
import { hasNavigationDraft } from "../navigation-drafts.tsx";
import { useProjectNavigation } from "./use-project-navigation.ts";

function Shell() { const nav = useProjectNavigation(); return nav.project ? <p>Opened {nav.project.id}</p> : <LibraryWorkspace onOpen={p => nav.navigate(p)} />; }
const details = async () => { fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" })); };
const close = () => fireEvent.click(screen.getByRole("button", { name: "Close" }));
beforeEach(() => { sessionStorage.clear(); history.replaceState({}, "", "/"); });
afterEach(() => { vi.restoreAllMocks(); history.replaceState({}, "", "/"); });
it.each(["Retry Library", "Refresh Library"])("reconciles failed organization through %s after closing/reopening Details", async refresh => {
  const b = libraryBoundary(); render(<Shell />); await details();
  const previous = b.fetch.getMockImplementation()!; let offline = true;
  b.fetch.mockImplementation(async (url, options) => offline && String(url) === "/api/projects/library"
    ? Response.json({ error: "offline" }, { status: 503 }) : previous(url, options));
  b.failNext("/focus", "focus offline"); fireEvent.click(screen.getByRole("button", { name: "Add to desk" }));
  await screen.findByText(/Latest Library could not be loaded/); close(); await details();
  expect(screen.getByRole("button", { name: "Refresh before retrying" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Add to desk" })).toBeDisabled(); close();
  history.pushState({}, "", "/?project=alpha"); fireEvent.popState(window); expect(location.search).toBe("");
  offline = false; if (refresh === "Refresh Library") fireEvent.click(screen.getByLabelText("Library tools"));
  fireEvent.click(screen.getByRole("button", { name: refresh }));
  await waitFor(() => expect(hasNavigationDraft(document)).toBe(false)); await details();
  expect(screen.getByRole("button", { name: "Add to desk" })).toBeEnabled();
  // A fresh later failure must reacquire both the lock and a reachable recovery control.
  offline = true; b.failNext("/focus", "offline again"); fireEvent.click(screen.getByRole("button", { name: "Add to desk" }));
  await screen.findByText(/Latest Library could not be loaded/);
  expect(screen.getByRole("button", { name: "Add to desk" })).toBeDisabled();
  expect(hasNavigationDraft(document)).toBe(true);
  offline = false; fireEvent.click(screen.getByRole("button", { name: "Refresh before retrying" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add to desk" })).toBeEnabled()); close();
  history.pushState({}, "", "/?project=alpha"); fireEvent.popState(window); await screen.findByText("Opened alpha");
});
it("requires explicit discard before replacing new or rename collection drafts", () => {
  render(<CollectionsDialog collections={[{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]} onChanged={async () => true} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("New collection name"), { target: { value: "Unsaved grouping" } });
  fireEvent.click(screen.getByRole("button", { name: "Rename Alpha" }));
  expect(screen.getByLabelText("New collection name")).toHaveValue("Unsaved grouping");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Rename Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.getByLabelText("Collection name")).toHaveValue("Alpha");
  fireEvent.change(screen.getByLabelText("Collection name"), { target: { value: "New Alpha" } });
  fireEvent.click(screen.getByRole("button", { name: "Rename Beta" }));
  expect(screen.getByLabelText("Collection name")).toHaveValue("New Alpha");
  fireEvent.click(screen.getByRole("button", { name: "Discard and switch" }));
  expect(screen.getByLabelText("Collection name")).toHaveValue("Beta");
  expect(hasNavigationDraft(document)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
  expect(screen.getByLabelText("New collection name")).toHaveValue("");
});
it("deleting another collection preserves the unrelated staged new name", async () => {
  libraryBoundary(); const changed = vi.fn(async () => true);
  render(<CollectionsDialog collections={[{ id: "a", name: "Alpha" }]} onChanged={changed} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("New collection name"), { target: { value: "Keep new grouping" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm delete collection" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(screen.getByLabelText("New collection name")).toHaveValue("Keep new grouping");
});
