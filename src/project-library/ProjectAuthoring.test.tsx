import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, libraryProject } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
const open = async () => fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" }));
beforeEach(() => sessionStorage.clear());
afterEach(() => { clearAuthToken(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe("Contextual project authoring", () => {
  it("uses the editable project name as the sheet title and keeps identity available", async () => {
    libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />); await open();
    const dialog = screen.getByRole("dialog", { name: "Alpha" });
    expect(dialog).toHaveClass("pl-dialog--sheet");
    expect(dialog.querySelector("header")).toContainElement(screen.getByLabelText("Display name"));
    expect(screen.getByLabelText("Description")).toHaveAttribute("placeholder", "Add a description…");
    expect(screen.getByText("/repo/alpha", { selector: "output" })).toBeVisible();
  });
  it("suggests existing tags, deduplicates additions and saves pending text without requiring syntax", async () => {
    const b = libraryBoundary({ projects: [libraryProject({ tags: ["api"] }), libraryProject({ id: "beta", name: "Beta", tags: ["design"] })] });
    render(<LibraryWorkspace onOpen={vi.fn()} />); await open();
    fireEvent.click(screen.getByRole("button", { name: "Add tag design" }));
    expect(screen.getByLabelText("Add tag")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Add tag"), { target: { value: "api" } });
    fireEvent.keyDown(screen.getByLabelText("Add tag"), { key: "Enter" });
    expect(screen.getAllByRole("button", { name: "Remove tag api" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag api" }));
    fireEvent.change(screen.getByLabelText("Add tag"), { target: { value: "web" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("All changes saved");
    expect(b.data.projects[0]!.tags).toEqual(["design", "web"]);
  });
  it("guards pending tag text and cancels without changing metadata", async () => {
    const b = libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />); await open();
    fireEvent.change(screen.getByLabelText("Add tag"), { target: { value: "unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Add tag")).toHaveValue("unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Add tag")).toHaveValue("");
    expect(b.data.projects[0]!.tags).toEqual([]);
  });
  it("creates and selects a collection beside an intact draft, with creation failures retryable", async () => {
    const b = libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />); await open();
    const description = screen.getByLabelText("Description");
    fireEvent.change(description, { target: { value: "Keep this draft" } });
    fireEvent.change(screen.getByLabelText("Find or create collection"), { target: { value: "Clients" } });
    b.failNext("/collections");
    fireEvent.click(screen.getByRole("button", { name: "Create collection Clients" }));
    await screen.findByText(/Couldn’t create collection/);
    expect(description).toHaveValue("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Create collection Clients" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Clients" })).toBeChecked());
    expect(description).toBe(screen.getByLabelText("Description"));
    expect(b.data.projects[0]!.collectionIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("All changes saved");
    expect(b.data.projects[0]).toMatchObject({ description: "Keep this draft", collectionIds: ["collection-1"] });
  });
  it("keeps metadata in details while tags remain usable for filtering", async () => {
    libraryBoundary({ projects: [libraryProject({ description: "Customer portal", tags: ["api", "web", "client", "extra"], collectionIds: ["c1"] })], collections: [{ id: "c1", name: "Clients" }] });
    render(<LibraryWorkspace onOpen={vi.fn()} />); await screen.findByRole("button", { name: "Open Alpha" });
    const card = screen.getByRole("article", { name: "Alpha" });
    expect(within(card).queryByText("Customer portal")).not.toBeInTheDocument();
    expect(card.querySelector(".pl-card-tags, .pl-card-metadata")).toBeNull();
    fireEvent.change(screen.getByLabelText("Collection"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove tag filter api" }));
    expect(screen.getByLabelText("Collection")).toHaveValue("c1");
    expect(screen.getByLabelText("Tag")).toHaveValue("");
    await open();
    expect(screen.getByLabelText("Description")).toHaveValue("Customer portal");
    expect(screen.getByLabelText("Repository path")).toHaveTextContent("/repo/alpha");
  });
});
