import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OrganizationActions } from "./OrganizationActions.tsx";
import { ProjectDetails } from "./ProjectDetails.tsx";
import { libraryProject } from "./test-fixture.ts";

const project = libraryProject({ tags: ["design", "api"], collectionIds: ["c1"] });
const collections = [{ id: "c1", name: "Customers" }, { id: "c2", name: "Internal" }];
const saveStatus = () => screen.getByRole("dialog").querySelector<HTMLElement>("footer .pl-footer-status")!;
const mount = (collectionList = collections) => render(<ProjectDetails project={project} collections={collectionList} onSaved={vi.fn()} onClose={vi.fn()} reload={async () => true}
  organization={<OrganizationActions project={project} disabled={false} busy={false} recoveryNeeded={false} actionError={null} feedback={null} onDesk={vi.fn()} onUpdates={vi.fn()} onRestore={vi.fn()} onOpen={vi.fn()} onArchive={vi.fn()} onRecover={vi.fn()} />} />);

describe("Details sheet structure", () => {
  it("uses editable content as the hierarchy, with repository identity beside metadata", () => {
    mount();
    const dialog = screen.getByRole("dialog", { name: "Alpha" });
    expect(dialog).toHaveClass("pl-dialog--details", "pl-dialog--sheet");
    expect(dialog.querySelector("header")).toContainElement(screen.getByLabelText("Display name"));
    expect(within(dialog).getByText("/repo/alpha").tagName).toBe("OUTPUT");
    for (const name of ["Display name", "Description", "Add tag"]) expect(within(dialog).getByLabelText(name)).toBeEnabled();
    const sections = [...dialog.querySelectorAll(".pl-dialog-body > fieldset")].map(section => section.querySelector("legend")!.textContent);
    expect(sections).toEqual(["Tags", "Collections", "Organization"]);
  });

  it("offers collections as labelled toggles that mirror the draft, and explains the empty case", () => {
    const view = mount();
    const group = screen.getByRole("group", { name: "Collections" });
    const customers = within(group).getByRole("checkbox", { name: "Customers" }); const internal = within(group).getByRole("checkbox", { name: "Internal" });
    expect(customers).toBeChecked(); expect(internal).not.toBeChecked();
    expect(customers.closest("label")).toHaveClass("pl-check"); expect(customers.closest(".pl-chips")).not.toBeNull();
    fireEvent.click(internal); expect(internal).toBeChecked();
    expect(saveStatus()).toHaveTextContent("Unsaved edits");
    view.unmount(); mount([]);
    expect(screen.getByText("Group related projects. Type a name to create your first collection.")).toBeVisible(); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("reports save state in the footer and holds organization actions until edits are saved or discarded", () => {
    mount();
    const status = saveStatus(); const organization = screen.getByRole("group", { name: "Organization" });
    expect(status).toHaveTextContent("All changes saved"); expect(status).toHaveAttribute("role", "status"); expect(status).toHaveAttribute("data-dirty", "false");
    expect(status.closest("footer")).toContainElement(screen.getByRole("button", { name: "Save changes" }));
    expect(within(organization).queryByText(/Save or discard edits/)).not.toBeInTheDocument();
    expect(within(organization).getByRole("button", { name: "Open Canvas" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Renamed" } });
    expect(status).toHaveTextContent("Unsaved edits"); expect(status).toHaveAttribute("data-dirty", "true");
    expect(within(organization).getByText("Save or discard edits before changing organization or opening work.")).toBeVisible();
    for (const button of within(organization).getAllByRole("button")) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(status).toHaveTextContent("All changes saved"); expect(within(organization).getByRole("button", { name: "Archive project" })).toBeEnabled();
  });
});
