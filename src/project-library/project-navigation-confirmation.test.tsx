import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigationDraft, NavigationDraftReveal } from "../navigation-drafts.tsx";
import { DraftNavigationDialog } from "./DraftNavigationDialog.tsx";
import { useProjectNavigation } from "./use-project-navigation.ts";
import { libraryBoundary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";

function Shell() {
  const nav = useProjectNavigation();
  const [visible, setVisible] = useState(false);
  return <>
    <output>{nav.project?.id ?? "Library"}</output>
    {!nav.project && <NavigationDraftReveal onOpen={() => setVisible(true)}>
      <div hidden={!visible}><NavigationDraft scope="test" dirty /><textarea aria-label="Draft" defaultValue="Keep this text" /></div>
    </NavigationDraftReveal>}
    <button onClick={() => nav.navigate({ id: "alpha", path: "/repo/alpha" })}>Switch project</button>
    {nav.blocked && <DraftNavigationDialog onClose={nav.clearBlocked} onConfirm={nav.confirmNavigation} onOpenDraft={nav.openDraft} />}
  </>;
}
beforeEach(() => { history.replaceState({}, "", "/"); sessionStorage.clear(); libraryBoundary(); });
afterEach(() => { history.replaceState({}, "", "/"); clearAuthToken(); vi.restoreAllMocks(); });
it("offers confirmation instead of trapping a draft, and switches only after confirmation", () => {
  render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
  expect(screen.getByRole("dialog", { name: "Leave active draft?" })).toHaveTextContent("You will lose the active draft");
  expect(location.search).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Leave and lose draft" }));
  expect(screen.getByRole("status")).toHaveTextContent("alpha");
  expect(new URL(location.href).searchParams.get("project")).toBe("alpha");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("opens the hidden draft without navigating, and allows a later confirmed switch", () => {
  render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
  fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep this text");
  expect(location.search).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(location.search).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
  fireEvent.click(screen.getByRole("button", { name: "Leave and lose draft" }));
  expect(screen.getByRole("status")).toHaveTextContent("alpha");
});
it("retains the attempted history destination until confirmed", async () => {
  render(<Shell />);
  await act(async () => { history.replaceState({}, "", "/?project=alpha&surface=canvas"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(location.search).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Leave and lose draft" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("alpha"));
  expect(new URL(location.href).searchParams.get("surface")).toBe("canvas");
});
