import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken, updateProject } from "../api.ts";
import { ProjectList } from "../ProjectList.tsx";
import { ProjectRename } from "./ProjectRename.tsx";
import { useProjectLoad } from "./use-project-load.ts";
import { useProjectOperation } from "./use-project-operation.ts";
import { useProjectInitialization } from "./use-project-initialization.ts";

const project = { id: "one", name: "Alpha", path: "/sample/alpha", nodes: [], transform: { x: 0, y: 0, scale: 1 }, hasSidecar: true, lastOpened: "2026-01-01" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const requests: { path: string; method: string; body: unknown }[] = [];
let response: (path: string, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  clearAuthToken();
  requests.length = 0;
  response = path => {
    if (path === "/api/auth/token") return json({ token: "test" });
    if (path === "/api/projects") return json([project]);
    if (path === "/api/projects/activity-summary") return json([{ projectId: "one", activeLeaders: 0, activeCrew: 0 }]);
    if (path.startsWith("/api/readiness")) return json({ ready: true });
    if (path === "/api/projects/git-status") return json({ isRepository: true });
    if (path === "/api/projects/path-suggestions") return json({ platform: "posix", separator: "/", roots: [], breadcrumbs: [], entries: [], truncated: false });
    return json(project);
  };
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    requests.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return response(path, init);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("project recovery at the HTTP boundary", () => {
  it("exits failed load, guards duplicate Retry, then hydrates a successful snapshot", async () => {
    const initial = response;
    let failed = true;
    const delayed = deferred<Response>();
    response = path => path === "/api/projects/one" ? (failed ? json({ error: "offline" }, 503) : delayed.promise) : initial(path);
    const hydrate = vi.fn();
    const { result } = renderHook(() => useProjectLoad("one", hydrate));
    await waitFor(() => expect(result.current.error).toContain("offline"));
    expect(result.current.loaded).toBe(false);
    failed = false;
    act(() => { result.current.retry(); result.current.retry(); });
    await waitFor(() => expect(requests.filter(r => r.path === "/api/projects/one")).toHaveLength(2));
    await act(async () => delayed.resolve(json(project)));
    expect(result.current.loaded).toBe(true);
    expect(result.current.error).toBeNull();
    expect(hydrate).toHaveBeenCalledExactlyOnceWith(project);
  });

  it("does not hydrate a stale project request after the selected identity changes", async () => {
    const first = deferred<Response>();
    const initial = response;
    response = path => path === "/api/projects/one" ? first.promise : initial(path);
    const hydrate = vi.fn();
    const hook = renderHook(({ id }) => useProjectLoad(id, hydrate), { initialProps: { id: "one" } });
    await waitFor(() => expect(requests.some(r => r.path === "/api/projects/one")).toBe(true));
    hook.rerender({ id: "two" });
    await waitFor(() => expect(hydrate).toHaveBeenCalledOnce());
    await act(async () => first.resolve(json({ ...project, name: "Stale" })));
    expect(hydrate).toHaveBeenCalledOnce();
  });

  it("serializes duplicate pending mutations and surfaces rejection without replay", async () => {
    const delayed = deferred<Response>();
    const initial = response;
    response = (path, init) => init?.method === "PUT" ? delayed.promise : initial(path, init);
    const { result } = renderHook(useProjectOperation);
    let first!: Promise<unknown>;
    act(() => {
      first = result.current.run(() => updateProject("one", { name: "Beta" }));
      void result.current.run(() => updateProject("one", { name: "Duplicate" }));
    });
    await waitFor(() => expect(requests.filter(r => r.method === "PUT")).toHaveLength(1));
    await act(async () => { delayed.resolve(json({ error: "rejected" }, 409)); await first; });
    expect(result.current.state.status).toBe("error");
    expect(requests.filter(r => r.method === "PUT")).toHaveLength(1);
  });

  it("does not navigate from a late open response after leaving Projects", async () => {
    const initial = response;
    const delayed = deferred<Response>();
    response = (path, init) => path === "/api/projects/open" ? delayed.promise : initial(path, init);
    const onOpen = vi.fn();
    const hook = renderHook(() => useProjectInitialization(onOpen));
    let task!: Promise<void>;
    act(() => { task = hook.result.current.initialize({ mode: "open", path: "/sample/alpha" }); });
    await waitFor(() => expect(requests.some(r => r.path === "/api/projects/open")).toBe(true));
    hook.unmount();
    await act(async () => { delayed.resolve(json(project)); await task; });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps Git initialization explicit on failure and Retry", async () => {
    const initial = response;
    response = (path, init) => path === "/api/projects/git-status" ? json({ isRepository: false }) : path === "/api/projects/open" ? json({ error: "cannot initialize" }, 500) : initial(path, init);
    const onOpen = vi.fn();
    const { result } = renderHook(() => useProjectInitialization(onOpen));
    await act(async () => result.current.initialize({ mode: "open", path: "/sample/plain" }));
    expect(result.current.gitDecision?.path).toBe("/sample/plain");
    expect(requests.filter(r => r.path === "/api/projects/open")).toHaveLength(0);
    await act(async () => result.current.initialize(result.current.gitDecision!, "initialize"));
    expect(result.current.state.status).toBe("error");
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.gitDecision).not.toBeNull());
    expect(requests.filter(r => r.path === "/api/projects/open")).toHaveLength(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows a Git preflight failure and opens only after explicit retry succeeds", async () => {
    const initial = response;
    let fail = true;
    response = (path, init) => path === "/api/projects/git-status" && fail ? json({ error: "cannot inspect" }, 503) : initial(path, init);
    const onOpen = vi.fn();
    const { result } = renderHook(() => useProjectInitialization(onOpen));
    await act(async () => result.current.initialize({ mode: "open", path: "/sample/alpha" }));
    expect(result.current.state.status).toBe("error");
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(onOpen).toHaveBeenCalledExactlyOnceWith("one", "/sample/alpha"));
  });

  it("keeps the rename draft on rejection, guards Enter repeats, and acknowledges server success", async () => {
    const initial = response;
    const delayed = deferred<Response>();
    response = (path, init) => init?.method === "PUT" ? delayed.promise : initial(path, init);
    render(<ProjectRename name="Alpha" onRename={name => updateProject("one", { name }).then(() => undefined)} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(input, { target: { value: " Beta " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toBeDisabled();
    await waitFor(() => expect(requests.filter(r => r.method === "PUT")).toHaveLength(1));
    await act(async () => delayed.resolve(json({ error: "write denied" }, 403)));
    expect(await screen.findByRole("alert")).toHaveTextContent("write denied");
    expect(input).toHaveValue(" Beta ");
    expect(input).toHaveFocus();
    response = initial;
    fireEvent.click(screen.getByRole("button", { name: "Retry rename" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Project renamed to “Beta”");
    expect(requests.filter(r => r.method === "PUT")).toHaveLength(2);
    expect(requests.filter(r => r.method === "PUT")[1]?.body).toEqual({ name: "Beta" });
  });

  it("does not save a rename on blur or cancellation and rejects empty submissions", () => {
    const close = vi.fn();
    render(<ProjectRename name="Alpha" onRename={name => updateProject("one", { name }).then(() => undefined)} onClose={close} />);
    const input = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(0);
  });

  it("keeps failed removal visible and routes Retry through the existing confirmation", async () => {
    const initial = response;
    response = (path, init) => init?.method === "DELETE" ? json({ error: "remove denied" }, 403) : initial(path, init);
    render(<ProjectList onOpenProject={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("remove denied");
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Retry removal" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Retry removal" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Your project folder and files will remain on disk");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(requests.filter(r => r.method === "DELETE")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open Alpha" })).toBeEnabled();
  });
});
