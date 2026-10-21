import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace.tsx";
import { libraryBoundary, libraryProject, summary } from "./test-fixture.ts";
import { clearAuthToken } from "../api.ts";
const openDetails = async (name = "Alpha") => { fireEvent.click(await screen.findByRole("button", {name:`Details and organization for ${name}`})); return screen.getByRole("dialog"); };
const close = () => fireEvent.click(screen.getByRole("button", {name:"Close"}));
describe("Library organization workflows at the authenticated HTTP boundary", () => {
  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { sessionStorage.clear(); clearAuthToken(); vi.restoreAllMocks(); });
  it("searches names/paths/tags, filters collections/tags, sorts, and preserves list/query on return", async () => {
    const boundary = libraryBoundary({projects:[libraryProject({tags:["web"],collectionIds:["client"]}),libraryProject({id:"beta",name:"Beta",path:"/work/z",tags:["api"]})],collections:[{id:"client",name:"Clients"}]});
    const props={onOpen:vi.fn()}; const view=render(<LibraryWorkspace {...props}/>);
    await screen.findByRole("button",{name:"Open Beta"});
    fireEvent.change(screen.getByLabelText("Sort projects"),{target:{value:"name"}});
    expect(screen.getAllByRole("article").map(e=>e.getAttribute("aria-label"))).toEqual(["Alpha","Beta"]);
    fireEvent.change(screen.getByLabelText("Search projects"),{target:{value:"api"}});
    expect(screen.queryByRole("button",{name:"Open Alpha"})).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Beta" })).toHaveClass("pl-index-row");
    fireEvent.click(screen.getByRole("button",{name:"Open Beta"}));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({id:"beta"}),{view:"activity"});
    expect(boundary.requests.some(r=>r.url.includes("acknowledge"))).toBe(false);
    view.unmount(); render(<LibraryWorkspace {...props}/>);
    await screen.findByRole("button",{name:"Open Beta"});
    expect(screen.getByLabelText("Search projects")).toHaveValue("api");
    expect(screen.getByRole("article", { name: "Beta" })).toHaveClass("pl-index-row");
    fireEvent.click(screen.getByRole("button",{name:"Clear search and filters"}));
    fireEvent.change(screen.getByLabelText("Collection"),{target:{value:"client"}});
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Tag"),{target:{value:"api"}});
    expect(screen.getByText("No matching projects")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Clear search and filters"}));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });
  it("retains staged edits on save failure, requires explicit close-discard, and retries the same revision", async () => {
    const b=libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()}/>);
    await openDetails();
    fireEvent.change(screen.getByLabelText("Display name"),{target:{value:"A very long name "+"x".repeat(150)}});
    fireEvent.change(screen.getByLabelText("Description"),{target:{value:"Staged description"}});
    fireEvent.change(screen.getByLabelText("Add tag"),{target:{value:"web, api, web"}});
    expect(screen.getByRole("button",{name:"Add to desk"})).toBeDisabled();
    close(); expect(screen.getByText(/Unsaved changes/)).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));
    b.failNext("/projects/alpha","OFFLINE");
    fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
    await screen.findByText(/Save failed/);
    expect(screen.getByLabelText("Description")).toHaveValue("Staged description");
    fireEvent.click(screen.getByRole("button",{name:"Retry save"}));
    await screen.findByText("All changes saved");
    const writes=b.requests.filter(r=>r.method==="PATCH");
    expect(writes).toHaveLength(2);
    expect(writes[1]!.body).toMatchObject({expectedRevision:0,tags:["web","api"],description:"Staged description"});
    fireEvent.change(screen.getByLabelText("Description"),{target:{value:"Never saved"}});
    close(); fireEvent.click(screen.getByRole("button",{name:"Discard and close"}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(b.data.projects[0]!.description).toBe("Staged description");
  });
  it("reloads a conflicting revision without overwriting the draft and explicitly discards to latest metadata", async () => {
    const b=libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()}/>); await openDetails();
    fireEvent.change(screen.getByLabelText("Description"),{target:{value:"My draft"}});
    b.data.projects[0]!.revision=3; b.data.projects[0]!.description="Remote change";
    b.failNext("/projects/alpha","REVISION_CONFLICT",409);
    fireEvent.click(screen.getByRole("button",{name:"Save changes"}));
    await screen.findByText(/Latest revision loaded/);
    expect(screen.getByLabelText("Description")).toHaveValue("My draft");
    fireEvent.click(screen.getByRole("button",{name:"Retry save"}));
    await screen.findByText("All changes saved");
    expect(b.requests.filter(r=>r.method==="PATCH").at(-1)!.body.expectedRevision).toBe(3);
    fireEvent.change(screen.getByLabelText("Description"),{target:{value:"Discard me"}});
    fireEvent.click(screen.getByRole("button",{name:"Discard changes"}));
    expect(screen.getByLabelText("Description")).toHaveValue("My draft");
  });
  it("does not claim a conflicting revision was loaded when the refresh also fails", async () => {
    const b=libraryBoundary(); const previous=b.fetch.getMockImplementation()!;
    render(<LibraryWorkspace onOpen={vi.fn()}/>); await openDetails();
    fireEvent.change(screen.getByLabelText("Description"), {target:{value:"Keep my draft"}});
    let failRefresh=true;
    b.fetch.mockImplementation(async (input, options) => String(input)==="/api/projects/library" && failRefresh
      ? new Response(JSON.stringify({error:"offline"}), {status:503}) : previous(input,options));
    b.failNext("/projects/alpha","REVISION_CONFLICT",409);
    fireEvent.click(screen.getByRole("button", {name:"Save changes"}));
    await screen.findByText(/Latest revision could not be loaded/);
    expect(screen.getByRole("button", {name:"Retry save"})).toBeDisabled();
    expect(screen.getByLabelText("Description")).toHaveValue("Keep my draft");
    failRefresh=false;
    fireEvent.click(screen.getByRole("button", {name:"Refresh latest revision"}));
    await screen.findByText(/Latest revision loaded/);
    expect(screen.getByRole("button", {name:"Retry save"})).toBeEnabled();
  });

  it("creates, renames, assigns and deletes a collection without deleting projects", async () => {
    const b=libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()}/>);
    await screen.findByRole("button",{name:"Open Alpha"});
    fireEvent.click(screen.getByLabelText("Library tools"));
    fireEvent.click(screen.getByRole("button",{name:"Manage collections"}));
    fireEvent.change(screen.getByLabelText("New collection name"),{target:{value:"Client projects"}});
    b.failNext("/collections");
    fireEvent.click(screen.getByRole("button",{name:"Create collection"}));
    await screen.findByText(/Your input is preserved/);
    expect(screen.getByLabelText("New collection name")).toHaveValue("Client projects");
    fireEvent.click(screen.getByRole("button",{name:"Create collection"}));
    await screen.findByRole("button",{name:"Rename Client projects"});
    fireEvent.click(screen.getByRole("button",{name:"Rename Client projects"}));
    fireEvent.change(screen.getByLabelText("Collection name"),{target:{value:"Clients"}});
    fireEvent.click(screen.getByRole("button",{name:"Save collection name"}));
    await screen.findByRole("button",{name:"Delete Clients"}); close();
    await openDetails(); fireEvent.click(screen.getByLabelText("Clients"));
    fireEvent.click(screen.getByRole("button",{name:"Save changes"})); await screen.findByText("All changes saved"); close();
    expect(b.data.projects[0]!.collectionIds).toEqual(["collection-1"]);
    fireEvent.click(screen.getByLabelText("Library tools"));
    fireEvent.click(screen.getByRole("button",{name:"Manage collections"}));
    fireEvent.click(screen.getByRole("button",{name:"Delete Clients"}));
    fireEvent.click(screen.getByRole("button",{name:"Confirm delete collection"}));
    await waitFor(()=>expect(screen.queryByRole("button",{name:"Delete Clients"})).not.toBeInTheDocument());
    expect(b.data.projects).toHaveLength(1); expect(b.data.projects[0]!.collectionIds).toEqual([]);
    expect(b.requests.filter(r=>r.method==="DELETE").map(r=>r.url)).toEqual(["/api/projects/library/collections/collection-1"]);
  });
  it("asks before closing staged collection input", async () => {
    libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />); await screen.findByRole("button", { name: "Open Alpha" });
    fireEvent.click(screen.getByLabelText("Library tools"));
    fireEvent.click(screen.getByRole("button", { name: "Manage collections" }));
    fireEvent.change(screen.getByLabelText("New collection name"), { target: { value: "Keep grouping" } });
    close(); expect(screen.getByLabelText("New collection name")).toHaveValue("Keep grouping");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" })); close();
    fireEvent.click(screen.getByRole("button", { name: "Discard collection edits" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("distinguishes a committed collection change from a failed refresh, so retry cannot duplicate creation", async () => {
    const b=libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()}/>);
    await screen.findByRole("button", {name:"Open Alpha"});
    fireEvent.click(screen.getByLabelText("Library tools"));
    fireEvent.click(screen.getByRole("button", {name:"Manage collections"}));
    fireEvent.change(screen.getByLabelText("New collection name"), {target:{value:"Saved once"}});
    // Fail only the post-save GET, not the collection mutation itself.
    const fetch=b.fetch.getMockImplementation()!;
    let failRefresh = true;
    b.fetch.mockImplementation(async (input,options) => {
      if (String(input).endsWith("/collections") && options?.method==="POST") {
        const collection={id:"committed",name:"Saved once"}; b.data.collections.push(collection);
        return new Response(JSON.stringify(collection), {headers:{"Content-Type":"application/json"}});
      }
      if (String(input) === "/api/projects/library" && failRefresh) {
        failRefresh = false;
        return new Response(JSON.stringify({error:"OFFLINE",code:"OFFLINE"}), {status:503,headers:{"Content-Type":"application/json"}});
      }
      return fetch(input,options);
    });
    fireEvent.click(screen.getByRole("button", {name:"Create collection"}));
    await screen.findByText(/Collection change saved/);
    expect(screen.getByRole("button", {name:"Create collection"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button", {name:"Refresh collections"}));
    await screen.findByRole("button", {name:"Rename Saved once"});
    expect(b.data.collections).toHaveLength(1);
  });

  it("does not report fresh recovery after organization and reload both fail", async () => {
    const b = libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()} />); await openDetails();
    const previous = b.fetch.getMockImplementation()!; let offline = true;
    b.fetch.mockImplementation(async (input, options) => offline && String(input) === "/api/projects/library"
      ? new Response(JSON.stringify({ error: "refresh offline" }), { status: 503 }) : previous(input, options));
    b.failNext("/focus", "focus offline");
    fireEvent.click(screen.getByRole("button", { name: "Add to desk" }));
    await screen.findByText(/Latest Library could not be loaded/);
    expect(screen.queryByText(/Latest Library loaded/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to desk" })).toBeDisabled();
    offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Refresh before retrying" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add to desk" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Add to desk" }));
    await screen.findAllByText(/Focus desk saved/);
  });
  it("adds, reorders and removes Focus membership without execution, with revision-fenced order", async () => {
    const b=libraryBoundary({projects:[libraryProject(),libraryProject({id:"beta",name:"Beta",focusOrder:0})],focusRevision:4});
    render(<LibraryWorkspace onOpen={vi.fn()}/>); await openDetails();
    fireEvent.click(screen.getByRole("button",{name:"Add to desk"}));
    await screen.findAllByText(/Focus desk saved/); close();
    fireEvent.click(screen.getByRole("button",{name:"Focus desk"}));
    expect(screen.getAllByRole("article").map(e=>e.getAttribute("aria-label"))).toEqual(["Beta","Alpha"]);
    fireEvent.click(screen.getByRole("button",{name:"Move Alpha earlier"}));
    await waitFor(()=>expect(screen.getAllByRole("article")[0]).toHaveAttribute("aria-label","Alpha"));
    fireEvent.click(screen.getByRole("button",{name:"Remove Alpha from desk"}));
    await waitFor(()=>expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(b.requests.filter(r=>r.url.endsWith("/focus")).map(r=>r.body)).toEqual([{expectedRevision:4,projectIds:["beta","alpha"]},{expectedRevision:5,projectIds:["alpha","beta"]},{expectedRevision:6,projectIds:["beta"]}]);
    expect(b.data.projects[0]!.archived).toBe(false);
    expect(b.requests.every(r=>r.url.startsWith("/api/projects/library"))).toBe(true);
  });
  it("archives reversibly via dedicated endpoints, preserving metadata and not re-adding Focus on restore", async () => {
    const b=libraryBoundary({projects:[libraryProject({focusOrder:0,tags:["keep"],description:"Keep history"})]});
    render(<LibraryWorkspace onOpen={vi.fn()}/>); await openDetails();
    fireEvent.click(screen.getByRole("button",{name:"Archive project"}));
    const confirm=await screen.findByRole("button",{name:"Confirm archive"}); await waitFor(()=>expect(confirm).toBeEnabled());
    fireEvent.click(confirm); await screen.findByText(/Archived “Alpha”/);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Archived"}));
    await openDetails(); fireEvent.click(screen.getByRole("button",{name:"Restore to Library"}));
    await screen.findAllByText(/Restored.*to Library/);
    expect(b.data.projects[0]).toMatchObject({id:"alpha",archived:false,focusOrder:null,tags:["keep"],description:"Keep history"});
    expect(b.requests.filter(r=>r.url.endsWith("/archive")||r.url.endsWith("/restore")).map(r=>r.body)).toEqual([{expectedRevision:0},{expectedRevision:1}]);
    expect(b.requests.some(r=>r.method==="DELETE")).toBe(false);
  });
  it.each(["running","attention","unknown"] as const)("does not enable archive from %s status", async state => {
    const b=libraryBoundary(); b.setSummaries([summary({state,archiveEligible:false,...(state==="unknown"?{freshness:"unknown",unread:null}: {})})]);
    render(<LibraryWorkspace onOpen={vi.fn()}/>); await openDetails(); fireEvent.click(screen.getByRole("button",{name:"Archive project"}));
    expect(await screen.findByRole("button",{name:"Confirm archive"})).toBeDisabled();
    expect(b.requests.some(r=>r.url.endsWith("/archive"))).toBe(false);
  });
  it("retains the archive confirmation on a server race rejection and permits fresh-status retry", async () => {
    const b=libraryBoundary(); render(<LibraryWorkspace onOpen={vi.fn()}/>); await openDetails();
    fireEvent.click(screen.getByRole("button",{name:"Archive project"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Confirm archive"})).toBeEnabled());
    b.failNext("/archive","ARCHIVE_UNSAFE",409);
    fireEvent.click(screen.getByRole("button",{name:"Confirm archive"}));
    await waitFor(()=>expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("ARCHIVE_UNSAFE"));
    expect(b.data.projects[0]!.archived).toBe(false);
    fireEvent.click(screen.getByRole("button",{name:"Confirm archive"}));
    await screen.findByText(/Archived “Alpha”/);
  });
  it("shows Library error/retry instead of fabricating an empty Library", async () => {
    const b=libraryBoundary(); b.failNext("/library"); render(<LibraryWorkspace onOpen={vi.fn()}/>);
    await screen.findByRole("alert"); expect(screen.queryByText("Start with a project")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Retry Library"}));
    await screen.findByRole("button",{name:"Open Alpha"});
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["Open Activity", "Open work item: Result ready"])("requires explicit restore at the common opening boundary for archived Updates: %s", async target => {
    const b = libraryBoundary({ projects: [libraryProject({ archived: true })] });
    const onOpen = vi.fn(); render(<LibraryWorkspace onOpen={onOpen} />);
    await screen.findByRole("button", { name: "Archived" });
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    await openDetails();
    fireEvent.click(screen.getByRole("button", { name: "Updates" }));
    fireEvent.click(await screen.findByRole("button", { name: target }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(b.requests.some(r => r.url.endsWith("/restore"))).toBe(false);
    const restore = await screen.findByRole("button", { name: "Restore to Library" });
    fireEvent.click(restore);
    await waitFor(() => expect(b.data.projects[0]!.archived).toBe(false));
    fireEvent.click(await screen.findByRole("button", { name: "Open Activity" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ archived: false }), { view: "activity" });
  });
});
