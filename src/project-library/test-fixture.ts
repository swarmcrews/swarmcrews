import { vi } from "vitest";
import { clearAuthToken, type ProjectSummary } from "../api.ts";
import type { LibraryLeaderPreview, LibraryProject, LibrarySummary, ProjectLibrary } from "../../shared/project-library/index.ts";
export const libraryProject = (p: Partial<LibraryProject> = {}): LibraryProject => ({ id:"alpha", workspaceId:"alpha", sourceRoot:"/repo/alpha", path:"/repo/alpha", name:"Alpha", displayName:null, description:"", tags:[], collectionIds:[], archived:false, focusOrder:null, revision:0, createdAt:"2026-01-01", lastOpened:"2026-01-02", ...p });
export const summary = (p: Partial<LibrarySummary> = {}): LibrarySummary => ({ projectId:"alpha", freshness:"fresh", checkedAt:new Date().toISOString(), expiresAt:new Date(Date.now()+15000).toISOString(), state:"up_to_date", activeLeaders:0, activeCrew:0, activeOther:0, activeWorkItems:0, attention:{total:0,decision:0,review:0,conflict:0}, unread:0, recent:null, archiveEligible:true, ...p });
export const fromRecent = (p: ProjectSummary) => libraryProject({ ...p, workspaceId:p.id, sourceRoot:p.path });
export function boundaryResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers:{ "Content-Type":"application/json" } }); }
/** Boundary handlers, not mocks of application modules: all components use real authenticated API clients. */
export function projectBoundary() {
  clearAuthToken();
  const handlers = {
    listProjects: vi.fn<() => Promise<ProjectSummary[]>>().mockResolvedValue([]),
    getProjectActivitySummary: vi.fn<(...args: unknown[]) => Promise<Array<{ projectId:string; activeLeaders:number; activeCrew:number }>>>().mockResolvedValue([]),
    getHarnessReadiness: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ ready:true, harnesses:[] }),
    getRepositoryPathSuggestions: vi.fn<(request: any) => Promise<any>>().mockResolvedValue({ platform:"posix",separator:"/",roots:[],directory:null,parent:null,breadcrumbs:[],entries:[],truncated:false }),
    checkProjectGit: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ isRepository:true }),
    openProject: vi.fn<(...args: unknown[]) => Promise<any>>(), createProject:vi.fn<(...args: unknown[]) => Promise<any>>(), deleteProject:vi.fn(),
  };
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
    const url=String(input); const body=options?.body ? JSON.parse(String(options.body)) : {};
    try {
      if (url === "/api/auth/token") return boundaryResponse({ token:"test" });
      expectAuth(options);
      if (url === "/api/projects/library") { const recents = await handlers.listProjects(); return boundaryResponse({ projects:recents.map(fromRecent), collections:[], focusRevision:0 }); }
      if (url === "/api/projects/library/activity") return boundaryResponse(body.projectIds.map((projectId: string) => ({ projectId, recent: null, leaders: [], checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30000).toISOString() })));
      if (url === "/api/projects/library/summary") { const activity = await handlers.getProjectActivitySummary(body.projectIds, options?.signal); return boundaryResponse(activity.map(s => summary({ ...s, state: s.activeLeaders > 0 || s.activeCrew > 0 ? "running" : "up_to_date" }))); }
      if (url.startsWith("/api/readiness")) return boundaryResponse(await handlers.getHarnessReadiness(...(url.includes("refresh") ? [true] : [])));
      if (url === "/api/projects/path-suggestions") return boundaryResponse(await handlers.getRepositoryPathSuggestions(body));
      if (url === "/api/projects/git-status") return boundaryResponse(await handlers.checkProjectGit(body.path));
      if (url === "/api/projects/open") return boundaryResponse(await handlers.openProject(body.path, ...(body.gitAction ? [body.gitAction] : [])));
      if (url === "/api/projects" && options?.method === "POST") return boundaryResponse(await handlers.createProject(body.name, body.path, ...(body.gitAction ? [body.gitAction] : [])));
      throw new Error(`Unexpected request ${url}`);
    } catch (err) { return boundaryResponse({ error:err instanceof Error ? err.message : String(err) }, 503); }
  });
  return { ...handlers, fetch };
}
function expectAuth(options?: RequestInit) { if (!(options?.headers as Record<string,string> )?.["Authorization"]?.startsWith("Bearer ")) throw new Error("Missing auth"); }
export function libraryBoundary(initial?: Partial<ProjectLibrary>) {
  clearAuthToken();
  let data: ProjectLibrary = { projects:[libraryProject()], collections:[], focusRevision:0, ...initial };
  const requests: Array<{ url:string; method:string; body:any }> = [];
  let leaderData: Record<string, LibraryLeaderPreview[]> = {};
  let summaryData: LibrarySummary[] = data.projects.map(p => summary({ projectId:p.id }));
  let failure: { match:string; status:number; code:string } | null = null;
  let events = [{ id:"event-1", revision:1, projectId:"alpha", workItemId:"work-1", kind:"work_item", text:"Result ready", at:Date.now(), unread:true, destination:{ view:"activity",workItemId:"work-1" } }];
  const fetch = vi.spyOn(globalThis,"fetch").mockImplementation(async (input, options) => {
    const url=String(input); const method=options?.method ?? "GET"; const body=options?.body ? JSON.parse(String(options.body)) : {};
    if (url === "/api/auth/token") return boundaryResponse({ token:"test" });
    expectAuth(options); requests.push({url,method,body});
    if (failure && url.includes(failure.match)) { const f=failure; failure=null; return boundaryResponse({error:f.code,code:f.code},f.status); }
    if (url === "/api/projects/library") return boundaryResponse(data);
    if (url === "/api/projects/library/activity") return boundaryResponse(body.projectIds.map((projectId: string) => ({ projectId, recent: summaryData.find(row => row.projectId === projectId)?.recent ?? null, leaders: leaderData[projectId] ?? [], checkedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30000).toISOString() })));
    if (url === "/api/projects/library/summary") return boundaryResponse(summaryData.filter(s => body.projectIds.includes(s.projectId)));
    if (url.endsWith("/focus")) { data={...data,focusRevision:data.focusRevision+1,projects:data.projects.map(p => ({...p,focusOrder:body.projectIds.includes(p.id) ? body.projectIds.indexOf(p.id) : null}))}; return boundaryResponse(data); }
    if (url.endsWith("/collections") && method === "POST") { const collection={id:`collection-${data.collections.length+1}`,name:body.name}; data.collections.push(collection); return boundaryResponse(collection); }
    if (url.includes("/collections/")) { const id=url.split("/").at(-1)!; if (method === "DELETE") { data.collections=data.collections.filter(c => c.id !== id); data.projects=data.projects.map(p=>({...p,collectionIds:p.collectionIds.filter(c=>c!==id)})); return boundaryResponse({ok:true}); } const c=data.collections.find(c=>c.id===id)!; c.name=body.name; return boundaryResponse(c); }
    if (url === "/api/projects/library/unread") { const counts=summaryData.map(s => s.unread ?? 0).filter(n => n > 0); return boundaryResponse({total:counts.reduce((a,b)=>a+b,0),projects:counts.length,asOf:Date.now()}); }
    if (url === "/api/projects/library/acknowledge-all") { const scope:string[]|undefined=body.projectIds; let cleared=0; summaryData=summaryData.map(s => { if (scope && !scope.includes(s.projectId)) return s; cleared+=s.unread ?? 0; return {...s,unread:0}; }); events=events.map(e => (!scope || scope.includes(e.projectId)) && e.at <= body.asOf ? {...e,unread:false} : e); return boundaryResponse({ok:true,cleared}); }
    if (url.includes("/events?")) return boundaryResponse({events,receipt:"signed-shown-page",nextCursor:null});
    if (url.includes("/attention?")) return boundaryResponse({items:[{workItemId:"work-1",title:"Result ready",revision:2,currentRunKey:"run-1",categories:["review"]}],nextCursor:null});
    if (url.endsWith("/acknowledge")) { summaryData=summaryData.map(s=>({...s,unread:Math.max(0,(s.unread ?? 0)-body.events.length)})); return boundaryResponse({ok:true}); }
    if (method === "PATCH" || url.endsWith("/archive") || url.endsWith("/restore")) {
      const id=url.match(/\/projects\/([^/]+)(?:\/archive|\/restore)?$/)?.[1]; const p=data.projects.find(p=>p.id===id)!;
      if (url.endsWith("/archive")) { p.archived=true;p.focusOrder=null; } else if (url.endsWith("/restore")) { p.archived=false;p.focusOrder=null; } else { Object.assign(p,body);p.name=body.displayName ?? p.name; }
      p.revision++; return boundaryResponse(p);
    }
    return boundaryResponse({error:`Unexpected request ${url}`},404);
  });
  return { fetch, requests, get data() { return data; }, setLeaders: (value: Record<string, LibraryLeaderPreview[]>) => { leaderData = value; }, setSummaries: (value:LibrarySummary[]) => { summaryData=value; }, failNext: (match:string, code="OFFLINE",status=503) => { failure={match,code,status}; }, setEvents: (value:typeof events) => { events=value; } };
}
