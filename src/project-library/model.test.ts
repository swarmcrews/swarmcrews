import { afterEach, describe, expect, it } from "vitest";
import { defaultFilters, loadFilters, persistFilters, projectDestination, projectPathHints, rememberDestination, selectProjects, summaryLabel } from "./model.ts";
import { libraryProject, summary } from "./test-fixture.ts";
afterEach(()=>sessionStorage.clear());
describe("Library selection and truthful state",()=>{
  it("disambiguates repeated names with unique path suffixes while unique and archived names stay quiet", () => {
    const hints = projectPathHints([
      libraryProject({ id: "a", name: "API", path: "/work/client/src/api" }),
      libraryProject({ id: "b", name: "API", path: "C:\\work\\server\\src\\api" }),
      libraryProject({ id: "c", name: "Web", path: "/work/web" }),
      libraryProject({ id: "d", name: "Web", path: "/archive/web", archived: true }),
    ]);
    expect([...hints]).toEqual([["a", "client/src/api"], ["b", "server/src/api"]]);
  });
  it("never treats absent, stale, unknown or contradictory quiet counters as idle",()=>{
    expect(summaryLabel(undefined,Date.now())).toBe("Status unknown");
    expect(summaryLabel(summary({freshness:"unknown",state:"up_to_date"}),Date.now())).toBe("Status unknown");
    expect(summaryLabel(summary({expiresAt:new Date(Date.now()-1).toISOString()}),Date.now())).toBe("Status stale");
    expect(summaryLabel(summary({activeWorkItems:1}),Date.now())).toBe("Status unknown");
    expect(summaryLabel(summary({unread:null}),Date.now())).toBe("Status unknown");
    expect(summaryLabel(summary(),Date.now())).toBe("Up to date");
  });
  it("deduplicates attention total rather than summing overlapping categories or unread",()=>{
    expect(summaryLabel(summary({state:"attention",unread:3,attention:{total:1,decision:1,review:1,conflict:1}}),Date.now())).toBe("1 need attention");
  });
  it("keeps unknown status out of filtering decisions, excludes archives from Focus, and stably orders ties",()=>{
    const library={projects:[libraryProject({id:"b",focusOrder:0}),libraryProject({id:"a",focusOrder:1}),libraryProject({id:"c",archived:true,focusOrder:2})],collections:[],focusRevision:0};
    expect(selectProjects(library,defaultFilters).map(p=>p.id)).toEqual(["a","b"]);
    expect(selectProjects(library,{...defaultFilters,view:"focus"}).map(p=>p.id)).toEqual(["b","a"]);
    expect(selectProjects(library,{...defaultFilters,view:"archived"}).map(p=>p.id)).toEqual(["c"]);
  });
  it("persists only validated view choices and record-owned destination identities",()=>{
    persistFilters({...defaultFilters,query:"long / unbroken",layouts:{ focus:"list", archived:"grid" },view:"focus"});
    expect(loadFilters()).toEqual({...defaultFilters,query:"long / unbroken",layouts:{ focus:"list", archived:"grid" },view:"focus"});
    sessionStorage.setItem("swarmcrews:library-view",JSON.stringify({view:"fake",sort:"random",query:3,collection:null}));
    expect(loadFilters()).toEqual(defaultFilters);
    rememberDestination("alpha",{view:"activity",workItemId:"exact-work"});
    expect(projectDestination("alpha")).toEqual({view:"activity",workItemId:"exact-work"});
    expect(projectDestination("beta")).toEqual({view:"activity"});
  });
});

it("replaces the obsolete last-opened default with activity recency", () => {
  sessionStorage.setItem("swarmcrews:library-view", JSON.stringify({ sort: "opened" }));
  expect(loadFilters().sort).toBe("activity");
});

it("validates each view's layout independently and replaces the obsolete shared preference", () => {
  sessionStorage.setItem("swarmcrews:library-view", JSON.stringify({ view: "archived", layout: "grid" }));
  expect(loadFilters().layouts).toEqual({ focus: "grid", archived: "list" });
  sessionStorage.setItem("swarmcrews:library-view", JSON.stringify({ layouts: { focus: "list", archived: "invalid" } }));
  expect(loadFilters().layouts).toEqual({ focus: "list", archived: "list" });
  sessionStorage.setItem("swarmcrews:library-view", JSON.stringify({ layouts: null }));
  expect(loadFilters().layouts).toEqual(defaultFilters.layouts);
});
