import { afterEach, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { getLibrary, getLibrarySummaries, saveLibraryProject } from "./api.ts";
import { boundaryResponse, libraryBoundary, summary } from "./test-fixture.ts";
afterEach(()=>{clearAuthToken(); vi.restoreAllMocks();});
it("retains execution evidence instead of falling back to unresolved-work counters", async () => {
  const boundary = libraryBoundary();
  boundary.setSummaries([summary({ state: "attention", running: false, runningLeaders: 0, activeLeaders: 2, activeWorkItems: 3, unread: 1 })]);
  expect(await getLibrarySummaries(["alpha"])).toEqual([expect.objectContaining({ running: false, runningLeaders: 0, activeLeaders: 2, activeWorkItems: 3 })]);
});
it("rejects malformed Library/summary response shapes instead of producing false quiet state",async()=>{
  clearAuthToken(); vi.spyOn(globalThis,"fetch").mockImplementation(async input=>String(input)==="/api/auth/token"?boundaryResponse({token:"test"}):boundaryResponse({projects:[],focusRevision:0}));
  await expect(getLibrary()).rejects.toThrow("Invalid Library response");
  await expect(getLibrarySummaries(["alpha"])).rejects.toThrow("Invalid Library response");
});
it("preserves bearer authorization, identity escaping and metadata revision fences",async()=>{
  const b=libraryBoundary();
  await saveLibraryProject("alpha",{expectedRevision:0,displayName:"Named",tags:["web"]});
  const call=b.fetch.mock.calls.find(([url,options])=>String(url).includes("/projects/alpha")&&options?.method==="PATCH")!;
  expect(call[1]?.headers).toMatchObject({Authorization:"Bearer test"});
  expect(JSON.parse(String(call[1]?.body))).toEqual({expectedRevision:0,displayName:"Named",tags:["web"]});
});
