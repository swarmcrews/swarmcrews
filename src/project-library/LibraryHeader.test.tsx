import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavigationDraft, openNavigationDraft } from "../navigation-drafts.tsx";
import { LibraryHeader } from "./LibraryHeader.tsx";

describe("library heading registration", () => {
  it("keeps heading actions together while the form expands below without remounting", () => {
    render(<LibraryHeader title="Project Library" tools={<button>Tools</button>} navigation={<nav>Views</nav>} empty={false}><input aria-label="Repository draft" defaultValue="" /></LibraryHeader>);
    const add = screen.getByRole("button", { name: "Add repository" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    expect(within(add.parentElement!).getByRole("button", { name: "Tools" })).toBeVisible();
    fireEvent.click(add);
    const draft = screen.getByRole("textbox", { name: "Repository draft" });
    expect(add.parentElement).not.toContainElement(draft);
    fireEvent.change(draft, { target: { value: "/keep/my/draft" } });
    fireEvent.click(add); expect(draft).not.toBeVisible();
    fireEvent.click(add); expect(screen.getByLabelText("Repository draft")).toBe(draft);
    expect(draft).toHaveValue("/keep/my/draft");
  });
  it("opens automatically for an empty library unless the user has already chosen", () => {
    const view = render(<LibraryHeader title="Project Library" tools={null} navigation={null} empty={false}><input aria-label="Draft" /></LibraryHeader>);
    view.rerender(<LibraryHeader title="Project Library" tools={null} navigation={null} empty><input aria-label="Draft" /></LibraryHeader>);
    const add = screen.getByRole("button", { name: "Add repository" });
    expect(add).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(add);
    view.rerender(<LibraryHeader title="Project Library" tools={null} navigation={null} empty><input aria-label="Draft" /></LibraryHeader>);
    expect(add).toHaveAttribute("aria-expanded", "false");
  });
});

it("reveals a retained registration draft through Open draft after the panel is collapsed", () => {
  render(<LibraryHeader title="Project Library" tools={null} navigation={null} empty={false}>
    <NavigationDraft scope="registration" dirty /><input aria-label="Repository draft" defaultValue="/keep/my/draft" />
  </LibraryHeader>);
  const add = screen.getByRole("button", { name: "Add repository" });
  fireEvent.click(add);
  const input = screen.getByRole("textbox", { name: "Repository draft" });
  fireEvent.click(add);
  expect(input).not.toBeVisible();
  act(() => openNavigationDraft());
  expect(add).toHaveAttribute("aria-expanded", "true");
  expect(input).toBeVisible();
  expect(input).toHaveValue("/keep/my/draft");
});
