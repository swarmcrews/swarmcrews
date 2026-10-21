import { NavigationDraft } from "../navigation-drafts.tsx";
import { leaderDraftScope, useLeaderDraftField } from "../nodes/leader/prompt/leader-drafts.ts";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { useProjectNavigation } from "./use-project-navigation.ts";
import { useRegistrationOpen } from "./use-registration-open.ts";
import { projectDestination, rememberDestination } from "./model.ts";
import { boundaryResponse, libraryBoundary, libraryProject } from "./test-fixture.ts";
beforeEach(()=>{window.history.replaceState({},"","/");sessionStorage.clear();});
afterEach(()=>{window.history.replaceState({},"","/");sessionStorage.clear();clearAuthToken();vi.restoreAllMocks();});
it("restores exact UUID/destination from deep links and rejects missing/archived IDs explicitly",async()=>{
  libraryBoundary(); window.history.replaceState({},"","/?project=alpha&surface=activity&workItem=exact-work");
  const {result}=renderHook(()=>useProjectNavigation());
  await waitFor(()=>expect(result.current.project?.id).toBe("alpha"));
  expect(projectDestination("alpha")).toEqual({view:"activity",workItemId:"exact-work"});
  await act(async()=>{window.history.replaceState({},"","/?project=missing");window.dispatchEvent(new PopStateEvent("popstate"));});
  await waitFor(()=>expect(result.current.error).toMatch(/unavailable or archived/));
  expect(result.current.project).toBeNull();
});
it("keeps the current project and URL when a registered draft guard blocks back/switch",async()=>{
  libraryBoundary(); const {result}=renderHook(()=>useProjectNavigation());
  rememberDestination("alpha",{view:"canvas"});
  act(()=>result.current.navigate({id:"alpha",path:"/repo/alpha"}));
  expect(new URL(window.location.href).searchParams.get("surface")).toBe("canvas");
  act(()=>result.current.registerGuard(()=>false));
  act(()=>result.current.navigate(null)); expect(result.current.project?.id).toBe("alpha");
  await act(async()=>{window.history.replaceState({},"","/");window.dispatchEvent(new PopStateEvent("popstate"));});
  expect(result.current.project?.id).toBe("alpha"); expect(new URL(window.location.href).searchParams.get("project")).toBe("alpha");
  act(()=>result.current.registerGuard(null)); act(()=>result.current.navigate(null)); expect(result.current.project).toBeNull();
});
it("does not let late URL resolution replace a newer explicit project navigation",async()=>{
  const b=libraryBoundary(); const fetch=b.fetch.getMockImplementation()!; let resolve!:(r:Response)=>void;
  b.fetch.mockImplementation((url,options)=>String(url)==="/api/projects/library"?new Promise(done=>{resolve=done;}):fetch(url,options));
  window.history.replaceState({},"","/?project=alpha");
  const {result}=renderHook(()=>useProjectNavigation()); await act(async()=>{});
  act(()=>result.current.navigate({id:"beta",path:"/repo/beta"}));
  await act(async()=>resolve(boundaryResponse(b.data)));
  expect(result.current.project?.id).toBe("beta");
});
it("ignores a late registration-status response after leaving Library",async()=>{
  const b=libraryBoundary(); const fetch=b.fetch.getMockImplementation()!; let resolve!:(r:Response)=>void;
  b.fetch.mockImplementation((url,options)=>String(url)==="/api/projects/library"?new Promise(done=>{resolve=done;}):fetch(url,options));
  const onOpen=vi.fn(); const {result,unmount}=renderHook(()=>useRegistrationOpen(onOpen));
  await act(async()=>{result.current.open("alpha","/repo/alpha");});
  unmount(); await act(async()=>resolve(boundaryResponse(b.data)));
  expect(onOpen).not.toHaveBeenCalled();
});
it("duplicate archived registration cannot silently open or restore it; Library failure offers recovery",async()=>{
  const b=libraryBoundary({projects:[libraryProject({archived:true})]}); const onOpen=vi.fn();
  const {result}=renderHook(()=>useRegistrationOpen(onOpen));
  await act(async()=>{result.current.open("alpha","/repo/alpha");});
  expect(onOpen).not.toHaveBeenCalled(); expect(result.current.notice).toMatch(/explicitly restore/);
  b.failNext("/library"); await act(async()=>{result.current.open("alpha","/repo/alpha");});
  expect(result.current.notice).toMatch(/Registration succeeded/);
  expect(b.requests.every(r=>r.method==="GET")).toBe(true);
});

it("confirmation still respects a failed or pending project-save guard", () => {
  const { result } = renderHook(() => useProjectNavigation());
  act(() => result.current.navigate({ id: "alpha", path: "/repo/alpha" }));
  render(<NavigationDraft scope="test" dirty />);
  act(() => result.current.registerGuard(() => false));
  act(() => result.current.navigate(null));
  expect(result.current.blocked).toBe(true);
  act(() => result.current.confirmNavigation());
  expect(result.current.project?.id).toBe("alpha");
  expect(new URL(location.href).searchParams.get("project")).toBe("alpha");
});
it("confirmed return to Library clears cached Leader drafts but cancellation preserves them", () => {
  const { result } = renderHook(() => useProjectNavigation());
  act(() => result.current.navigate({ id: "alpha", path: "/repo/alpha" }));
  const scope = leaderDraftScope("alpha", "node-1", {});
  const draft = renderHook(() => useLeaderDraftField(scope, "text", ""));
  act(() => draft.result.current[1]("Unsent text"));
  render(<NavigationDraft scope="test" dirty />);
  act(() => result.current.navigate(null));
  act(() => result.current.clearBlocked());
  expect(draft.result.current[0]).toBe("Unsent text");
  act(() => result.current.navigate(null));
  act(() => result.current.confirmNavigation());
  expect(result.current.project).toBeNull();
  draft.unmount();
  const reopened = renderHook(() => useLeaderDraftField(scope, "text", ""));
  expect(reopened.result.current[0]).toBe("");
});
