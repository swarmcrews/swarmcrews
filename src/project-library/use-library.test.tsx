import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { useLibrary, useLibrarySummaries } from "./use-library.ts";
import { boundaryResponse, libraryBoundary, summary } from "./test-fixture.ts";
beforeEach(()=>{ vi.useFakeTimers(); });
afterEach(()=>{ vi.useRealTimers(); clearAuthToken(); vi.restoreAllMocks(); });
const flush=async()=>{ await act(async()=>{}); };
describe("Shared batched visibility refresh",()=>{
  it("expires a cached running summary while its next mobile refresh is stalled", async () => {
    const b = libraryBoundary(); b.setSummaries([summary({ state: "running", activeLeaders: 1, running: true })]);
    const { result, unmount } = renderHook(() => useLibrarySummaries(["alpha"])); await flush();
    const cached = result.current.summaries["alpha"]!;
    const base = b.fetch.getMockImplementation()!;
    b.fetch.mockImplementation((url, options) => String(url).endsWith("/summary") ? new Promise<Response>(() => {}) : base(url, options));
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(result.current.summaries["alpha"]).toEqual(cached);
    expect(result.current.now).toBeGreaterThanOrEqual(Date.parse(cached.expiresAt));
    expect(b.requests.filter(request => request.url.endsWith("/summary"))).toHaveLength(1);
    expect(b.fetch.mock.calls.filter(([url]) => String(url).endsWith("/summary"))).toHaveLength(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(b.fetch.mock.calls.filter(([url]) => String(url).endsWith("/summary"))).toHaveLength(3);
  });

  it("recovers empty/error startup on focus/visibility/reconnect, retaining the last known records",async()=>{
    const b=libraryBoundary({projects:[]});
    const {result}=renderHook(()=>useLibrary()); await flush(); expect(result.current.library.projects).toEqual([]);
    b.failNext("/library"); await act(async()=>{window.dispatchEvent(new Event("focus"));});
    expect(result.current.error).toBe("OFFLINE");
    b.data.projects.push({id:"a",workspaceId:"a",sourceRoot:"/a",path:"/a",name:"A",displayName:null,description:"",tags:[],collectionIds:[],archived:false,focusOrder:null,revision:0,createdAt:"2026",lastOpened:null});
    await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));});
    expect(result.current.library.projects).toHaveLength(1); expect(result.current.error).toBeNull();
    b.failNext("/library"); await act(async()=>{await result.current.reload();});
    expect(result.current.library.projects).toHaveLength(1); expect(result.current.error).toBe("OFFLINE");
    await act(async()=>{window.dispatchEvent(new Event("online"));}); expect(result.current.error).toBeNull();
  });
  it("does not overlap pending requests or update after unmount",async()=>{
    const b=libraryBoundary(); const original=b.fetch.getMockImplementation()!; let resolve!:(response:Response)=>void;
    b.fetch.mockImplementation((url,options)=>String(url)==="/api/projects/library"?new Promise(done=>{resolve=done;}):original(url,options));
    const {result,unmount}=renderHook(()=>useLibrary()); await flush();
    expect(result.current.loading).toBe(true);
    const count=b.fetch.mock.calls.length;
    await act(async()=>{window.dispatchEvent(new Event("online"));window.dispatchEvent(new Event("focus"));await vi.advanceTimersByTimeAsync(15000);});
    expect(b.fetch).toHaveBeenCalledTimes(count);
    unmount(); await act(async()=>{resolve(boundaryResponse(b.data));await vi.advanceTimersByTimeAsync(15000);});
    expect(b.fetch).toHaveBeenCalledTimes(count);
  });
  it("deduplicates IDs, limits requests to 100, pauses hidden tabs and deduplicates focus/visibility events",async()=>{
    const b=libraryBoundary(); const visibility=vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");
    const ids=Array.from({length:205},(_,i)=>String(i));
    const {unmount}=renderHook(()=>useLibrarySummaries([...ids,"1"])); await flush();
    const requests=()=>b.requests.filter(r=>r.url.endsWith("/summary"));
    expect(requests().map(r=>r.body.projectIds.length)).toEqual([100,100,5]);
    expect(new Set(requests().flatMap(r=>r.body.projectIds)).size).toBe(205);
    await act(async()=>{window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));}); expect(requests()).toHaveLength(3);
    visibility.mockReturnValue("hidden"); await act(async()=>{await vi.advanceTimersByTimeAsync(10000);}); expect(requests()).toHaveLength(3);
    visibility.mockReturnValue("visible"); await act(async()=>{window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));}); expect(requests()).toHaveLength(6);
    unmount(); await act(async()=>{await vi.advanceTimersByTimeAsync(10000);}); expect(requests()).toHaveLength(6);
  });
  it("keeps expiry advancing on failed refresh rather than turning unavailable status quiet",async()=>{
    const b=libraryBoundary(); const {result}=renderHook(()=>useLibrarySummaries(["alpha"])); await flush();
    const previous=result.current.summaries["alpha"]!; b.failNext("/summary");
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
    expect(result.current.error).toBe("OFFLINE"); expect(result.current.summaries["alpha"]).toEqual(previous);
    expect(result.current.now).toBeGreaterThan(Date.parse(previous.checkedAt));
  });
});

it("refreshes displayed cards within two seconds and immediately after reconnect", async () => {
  const b = libraryBoundary(); const { result } = renderHook(() => useLibrarySummaries(["alpha"])); await flush();
  b.setSummaries([summary({ state: "running", running: true, activeLeaders: 1 })]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(result.current.summaries["alpha"]?.running).toBe(true);
  b.setSummaries([summary({ state: "up_to_date", running: false })]);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); window.dispatchEvent(new Event("online")); });
  expect(result.current.summaries["alpha"]?.running).toBe(false);
});

it("times out stalled requests, retries, and rejects late obsolete results", async () => {
  const b = libraryBoundary(); const original = b.fetch.getMockImplementation()!;
  let release!: (response: Response) => void; let signal: AbortSignal | undefined;
  b.fetch.mockImplementationOnce((url, options) => original(url, options)); // auth
  let held = false;
  b.fetch.mockImplementation((url, options) => {
    if (String(url).endsWith("/summary") && !held) { held = true; signal = options?.signal as AbortSignal; return new Promise(done => { release = done; }); }
    return original(url, options);
  });
  const { result } = renderHook(() => useLibrarySummaries(["alpha"])); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(signal?.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(result.current.summaries["alpha"]?.state).toBe("up_to_date");
  await act(async () => { release(boundaryResponse([summary({ state: "running", running: true })])); });
  expect(result.current.summaries["alpha"]?.state).toBe("up_to_date");
});

it("drops omitted and off-screen summaries rather than preserving stale Running entries", async () => {
  const b = libraryBoundary(); b.setSummaries([summary({ state: "running", running: true })]);
  const view = renderHook(({ ids }) => useLibrarySummaries(ids), { initialProps: { ids: ["alpha"] } }); await flush();
  b.setSummaries([]);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(view.result.current.summaries["alpha"]).toBeUndefined();
  b.setSummaries([summary({ projectId: "beta" })]);
  view.rerender({ ids: ["beta"] }); await flush();
  expect(Object.keys(view.result.current.summaries)).toEqual(["beta"]);
});

it("uses the same single batch for 24 cards and performs no hidden-tab polling", async () => {
  const b = libraryBoundary(); const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  renderHook(() => useLibrarySummaries(Array.from({ length: 24 }, (_, i) => String(i)))); await flush();
  const requests = () => b.requests.filter(r => r.url.endsWith("/summary"));
  expect(requests()).toHaveLength(1); expect(requests()[0]!.body.projectIds).toHaveLength(24);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(requests()).toHaveLength(2);
  visibility.mockReturnValue("hidden");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(60000); });
  expect(requests()).toHaveLength(2);
  visibility.mockReturnValue("visible");
  await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(requests()).toHaveLength(3);
});
