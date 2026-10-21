import { LeaderPromptBar } from "../nodes/leader/prompt/LeaderPromptBar.tsx";
import { PromptAttachmentsContext, usePromptAttachments } from "../nodes/leader/prompt/use-prompt-attachments.ts";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { useProjectNavigation } from "./use-project-navigation.ts";
import { useDraftSurface } from "./use-draft-surface.ts";
import { ContextActionsSettings, type SettingsSaveState } from "../ContextActionsSettings.tsx";
import { clearAuthToken } from "../api.ts";
import { libraryBoundary } from "./test-fixture.ts";
function LibraryShell() {
  const nav = useProjectNavigation();
  return nav.project ? <p>Project {nav.project.id}</p> : <LibraryWorkspace onOpen={p => nav.navigate({ id: p.id, path: p.path })} />;
}
async function historyProject() {
  await act(async () => { history.replaceState({}, "", "/?project=alpha"); window.dispatchEvent(new PopStateEvent("popstate")); });
}
beforeEach(() => { history.replaceState({}, "", "/"); sessionStorage.clear(); });
afterEach(() => { history.replaceState({}, "", "/"); sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });
it("retains name-only Library details through history, then allows navigation after explicit discard", async () => {
  libraryBoundary(); render(<LibraryShell />);
  fireEvent.click(await screen.findByRole("button", { name: "Details and organization for Alpha" }));
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Unsaved name" } });
  await historyProject();
  expect(screen.getByLabelText("Display name")).toHaveValue("Unsaved name");
  expect(new URL(location.href).searchParams.has("project")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await historyProject(); await screen.findByText("Project alpha");
});
it("retains collection input and an in-flight metadata save through history", async () => {
  const b = libraryBoundary(); const original = b.fetch.getMockImplementation()!;
  render(<LibraryShell />); await screen.findByRole("button", { name: "Open Alpha" });
  fireEvent.click(screen.getByLabelText("Library tools"));
    fireEvent.click(screen.getByRole("button", { name: "Manage collections" }));
  fireEvent.change(screen.getByLabelText("New collection name"), { target: { value: "Staged grouping" } });
  await historyProject(); expect(screen.getByLabelText("New collection name")).toHaveValue("Staged grouping");
  fireEvent.change(screen.getByLabelText("New collection name"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Details and organization for Alpha" }));
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Saved name" } });
  let release!: () => void;
  b.fetch.mockImplementation(async (url, opts) => {
    if (opts?.method === "PATCH") await new Promise<void>(resolve => { release = resolve; });
    return original(url, opts);
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(release).toBeDefined()); await historyProject();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(async () => release()); await screen.findByText("All changes saved");
  await historyProject(); await screen.findByText("Project alpha");
});
function SettingsSurface({ saveState = { status: "idle" } }: { saveState?: SettingsSaveState }) {
  const [, setView] = useState("settings"); const surface = useDraftSurface(setView);
  return <><div ref={surface.root}><ContextActionsSettings settings={{ dashboardLeaderActions: [{ id: "saved", name: "Saved action", prompt: "Persisted prompt", icon: "zap", skillIds: [] }] }} onSettingsChange={() => {}} saveState={saveState} /></div>
    <button onClick={() => surface.changeView("away")}>Check navigation</button><output data-testid="draft">{String(surface.hasDraft)}</output></>;
}
it("does not classify untouched saved Context Actions as drafts", () => {
  render(<SettingsSurface />); fireEvent.click(screen.getByRole("button", { name: "Check navigation" }));
  expect(screen.getByTestId("draft")).toHaveTextContent("false");
});
it.each(["name", "deletion"])("retains actual Context Action %s edits even with an empty prompt", edit => {
  render(<SettingsSurface />);
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "" } });
  if (edit === "name") fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Unsaved name" } });
  fireEvent.click(screen.getByRole("button", { name: "Check navigation" }));
  expect(screen.getByTestId("draft")).toHaveTextContent("true");
});
it.each(["saving", "error"] as const)("retains Context Action %s ownership even without editable text", status => {
  render(<SettingsSurface saveState={{ status }} />);
  fireEvent.click(screen.getByRole("button", { name: "Check navigation" }));
  expect(screen.getByTestId("draft")).toHaveTextContent("true");
});

function AttachmentSurface() {
  const [, setView] = useState("canvas"); const surface = useDraftSurface(setView); const attachments = usePromptAttachments();
  return <><div ref={surface.root}><PromptAttachmentsContext.Provider value={attachments}>
    <LeaderPromptBar input="" onInputChange={() => {}} onKeyDown={() => {}} onSubmit={() => {}} placeholder="Prompt" submitLabel="Send" disabled={false} active />
  </PromptAttachmentsContext.Provider></div>
  <button onClick={() => attachments.addFiles([new File(["Notes"], "notes.txt", { type: "text/plain" })])}>Attach only</button>
  <button onClick={() => surface.changeView("activity")}>Check navigation</button><output data-testid="draft">{String(surface.hasDraft)}</output></>;
}
it("retains attachment-only Canvas drafts during decoding and after it completes", async () => {
  render(<AttachmentSurface />); fireEvent.click(screen.getByRole("button", { name: "Attach only" }));
  fireEvent.click(screen.getByRole("button", { name: "Check navigation" })); expect(screen.getByTestId("draft")).toHaveTextContent("true");
  await waitFor(() => expect(screen.getByText("notes.txt")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Check navigation" })); expect(screen.getByTestId("draft")).toHaveTextContent("true");
  fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "Check navigation" })); expect(screen.getByTestId("draft")).toHaveTextContent("false");
});
it("rechecks draft ownership when a slow history lookup resolves", async () => {
  const b = libraryBoundary(); render(<LibraryShell />); await screen.findByRole("button", { name: "Open Alpha" });
  const original = b.fetch.getMockImplementation()!; let release!: () => void;
  b.fetch.mockImplementation(async (url, opts) => {
    if (String(url) === "/api/projects/library") await new Promise<void>(resolve => { release = resolve; });
    return original(url, opts);
  });
  await historyProject(); await waitFor(() => expect(release).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Details and organization for Alpha" }));
  fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Late draft" } });
  await act(async () => release());
  expect(screen.getByLabelText("Display name")).toHaveValue("Late draft");
  expect(new URL(location.href).searchParams.has("project")).toBe(false);
});
