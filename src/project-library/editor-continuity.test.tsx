import { useReducer, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Canvas } from "../Canvas.tsx";
import { ProjectPanel } from "../ProjectPanel.tsx";
import { DockProvider } from "../BottomRightDock.tsx";
import { canvasReducer } from "../canvas-state.ts";
import { hasNavigationDraft } from "../navigation-drafts.tsx";
import { useDraftSurface } from "./use-draft-surface.ts";
import { useProjectNavigation } from "./use-project-navigation.ts";
import { libraryBoundary } from "./test-fixture.ts";

const send = vi.fn();
function EmptyCanvas() {
  const [nodes, dispatch] = useReducer(canvasReducer, []);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  return <Canvas nodes={nodes} dispatch={dispatch} graph={{ edges: [] }} graphDispatch={() => {}}
    transform={transform} setTransform={setTransform} socketSend={send} projectId="alpha" projectPath="/work/alpha" />;
}
function Surface({ panel = false }: { panel?: boolean }) {
  const [view, setView] = useState("canvas"); const surface = useDraftSurface(setView); const nav = useProjectNavigation();
  return <DockProvider><button onClick={() => surface.changeView(view === "canvas" ? "activity" : "canvas")}>Switch surface</button>
    <button onClick={() => nav.navigate({ id: "beta", path: "/work/beta" })}>Switch project</button>
    <output>{nav.blocked ? "Navigation blocked" : nav.project?.id ?? "Original project"}</output>
    {(view === "canvas" || surface.hasDraft) && <div ref={surface.root} hidden={view !== "canvas"}>
      {panel ? <ProjectPanel projectId="alpha" projectPath="/work/alpha" projectName="Project" nodes={[]} onSpawnContextExplorer={() => {}} /> : <EmptyCanvas />}
    </div>}
  </DockProvider>;
}
function historyAway() {
  window.history.pushState({}, "", "/?project=beta"); fireEvent.popState(window);
}
function contextBoundary() {
  const boundary = libraryBoundary(); const previous = boundary.fetch.getMockImplementation()!;
  let content = "Persisted context";
  boundary.fetch.mockImplementation(async (url, options) => {
    if (String(url).endsWith("/context")) {
      if (options?.method === "PUT") { content = JSON.parse(String(options.body)).content; return Response.json({ ok: true }); }
      return Response.json({ content, exists: true });
    }
    if (String(url).includes("/tree?")) return Response.json({ root: "/work/alpha", tree: [] });
    return previous(url, options);
  });
  return boundary;
}
async function editContext() {
  fireEvent.click(screen.getByRole("button", { name: /Project$/ }));
  fireEvent.click(screen.getByRole("button", { name: "context" }));
  await screen.findByText("Persisted context"); fireEvent.click(screen.getByRole("button", { name: "Edit" }));
}
beforeEach(() => { window.history.replaceState({}, "", "/"); sessionStorage.clear(); send.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

it("retains the actual Empty Canvas description across Activity and blocks project/history departure", async () => {
  libraryBoundary(); render(<Surface />);
  fireEvent.change(screen.getByLabelText("Context description"), { target: { value: "Keep original empty canvas draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" }));
  expect(screen.getByLabelText("Context description")).toHaveValue("Keep original empty canvas draft");
  expect(screen.getByLabelText("Context description")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Switch project" })); expect(screen.getByText("Navigation blocked")).toBeVisible();
  historyAway(); expect(window.location.search).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" }));
  expect(screen.getByLabelText("Context description")).toBeVisible();
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "create_work_item" }));
  fireEvent.change(screen.getByLabelText("Context description"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" }));
  expect(screen.queryByLabelText("Context description")).toBeNull();
});
it.each(["Unsaved context", ""])("retains actual Project Context edits (%j), including collapsed ownership", async value => {
  contextBoundary(); render(<Surface panel />); await editContext();
  expect(hasNavigationDraft(document)).toBe(false);
  fireEvent.change(screen.getByLabelText("Workspace context"), { target: { value } });
  expect(hasNavigationDraft(document)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "✕" }));
  expect(hasNavigationDraft(document)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch project" })); expect(screen.getByText("Navigation blocked")).toBeVisible();
  historyAway(); expect(window.location.search).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" }));
  fireEvent.click(screen.getByRole("button", { name: /Project$/ }));
  expect(screen.getByLabelText("Workspace context")).toHaveValue(value);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(hasNavigationDraft(document)).toBe(false);
});
it("owns pending/failed Context saves until retry succeeds, without losing edits", async () => {
  const b = contextBoundary(); render(<Surface panel />); await editContext();
  fireEvent.change(screen.getByLabelText("Workspace context"), { target: { value: "Save these instructions" } });
  const previous = b.fetch.getMockImplementation()!; let resolve!: (value: Response) => void; let pending = true;
  b.fetch.mockImplementation(async (url, options) => options?.method === "PUT" && pending ? new Promise<Response>(r => { resolve = r; }) : previous(url, options));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  expect(document.querySelector('[data-navigation-scope="project-context"]')).toHaveAttribute("data-navigation-state", "pending");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  historyAway(); expect(window.location.search).toBe("");
  await act(async () => resolve(Response.json({ error: "offline" }, { status: 503 })));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be saved/i);
  expect(document.querySelector('[data-navigation-scope="project-context"]')).toHaveAttribute("data-navigation-state", "failed");
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" }));
  expect(screen.getByLabelText("Workspace context")).toHaveValue("Save these instructions");
  pending = false; fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("button", { name: "Edit" }); expect(hasNavigationDraft(document)).toBe(false);
});
it("allows quiet Empty Canvas and untouched saved Context to unmount", async () => {
  contextBoundary(); const first = render(<Surface />);
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" })); expect(screen.queryByLabelText("Context description")).toBeNull(); first.unmount();
  render(<Surface panel />); await editContext();
  expect(hasNavigationDraft(document)).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Switch surface" })); expect(screen.queryByLabelText("Workspace context")).toBeNull();
});
