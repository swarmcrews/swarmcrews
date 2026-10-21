import fs from "node:fs";
import path from "node:path";
import express, { Router } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateTaskGraph } from "../../server/task-graph/schema.ts";
import { mountLibraryRoutes } from "../../server/project-library/routes.ts";
import { libraryFixture, runtimeFixture, workspaceFixture, itemFixture, leaderItemFixture, changeItem } from "../../server/project-library/test-fixture.ts";
import { createExpressFetch } from "../harness/in-process-http.ts";
import { createApiAuthMiddleware } from "../../server/http-security.ts";
import { projectActivitySummary } from "../../server/project-activity.ts";
import { openPersistDb, closePersistDb } from "../../server/session-persist.ts";
import type { SessionHost } from "../../server/session-host.ts";
import type { LibraryEventPage, LibraryProject, LibrarySummary, ProjectLibrary } from "../../shared/project-library/index.ts";

let fixture: ReturnType<typeof libraryFixture>; let runtime: ReturnType<typeof runtimeFixture>;
let workspace: ReturnType<typeof workspaceFixture>; let fetch: typeof globalThis.fetch;
let hosts: Map<string, SessionHost>; let available: boolean;
function mount() {
  const router = Router();
  mountLibraryRoutes(router, { runtimeDb: () => available ? runtime : null,
    runtimeReader: ids => projectActivitySummary(hosts, ids) });
  const app = express(); app.use(express.json());
  app.use("/api/projects", createApiAuthMiddleware("library-token"), router);
  return createExpressFetch(app);
}
const url = "http://in-process.local/api/projects/library";
function request(route = "", body?: unknown, method = body === undefined ? "GET" : "POST", auth = true) {
  return fetch(url + route, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer library-token" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => { fixture = libraryFixture(); vi.stubEnv("SWARMCREWS_HOME", fixture.home);
  closePersistDb(); runtime = openPersistDb(path.join(fixture.root, "server.db")); workspace = workspaceFixture(fixture.root); hosts = new Map(); available = true; fetch = mount(); });
afterEach(() => { closePersistDb(); vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });
async function readLibrary() { return await (await request()).json() as ProjectLibrary; }
async function readSummary() { return (await (await request("/summary", { projectIds: [workspace.id] })).json() as LibrarySummary[])[0]!; }

describe("Project Library authenticated real-service REST contract", () => {
  it("persists collection/metadata/Focus across DB and route recreation without creating runs", async () => {
    const second = workspaceFixture(fixture.root, "Second");
    const create = await request("/collections", { name: "Clients" }); expect(create.status).toBe(200);
    const group = await create.json() as { id: string; name: string };
    const patch = await request(`/projects/${workspace.id}`, { expectedRevision: 0, displayName: "Custom", description: "Saved notes",
      tags: ["work"], collectionIds: [group.id] }, "PATCH");
    expect(patch.status).toBe(200); expect(patch.headers.get("cache-control")).toBe("no-store");
    expect((await request(`/collections/${group.id}`, { name: "Customers" }, "PATCH")).status).toBe(200);
    expect((await request("/focus", { expectedRevision: 0, projectIds: [second.id, workspace.id] }, "PUT")).status).toBe(200);
    closePersistDb(); runtime = openPersistDb(path.join(fixture.root, "server.db")); fetch = mount();
    const persisted = await readLibrary();
    expect(persisted.focusRevision).toBe(1); expect(persisted.collections).toEqual([{ id: group.id, name: "Customers" }]);
    expect(persisted.projects.find(p => p.id === workspace.id)).toMatchObject({ name: "Custom", description: "Saved notes", tags: ["work"], collectionIds: [group.id], focusOrder: 1 });
    expect((await request(`/collections/${group.id}`, undefined, "DELETE")).status).toBe(200);
    expect((await readLibrary()).projects.find(p => p.id === workspace.id)).toMatchObject({ collectionIds: [], focusOrder: 1 });
    expect(runtime.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect(fs.readFileSync(path.join(workspace.sourceRoot, "keep.txt"), "utf8")).toBe("Preserve source");
  });
  it("reads never approve review, exact displayed acknowledgment excludes concurrent arrivals", async () => {
    leaderItemFixture(runtime, workspace, "work"); changeItem(runtime, "work", { runtime: "inactive", outcome: "completed" });
    expect(await readSummary()).toMatchObject({ state: "attention", unread: 1, attention: { total: 1, review: 1 } });
    const page = await (await request(`/projects/${workspace.id}/events`)).json() as LibraryEventPage;
    expect(await readSummary()).toMatchObject({ unread: 1 });
    changeItem(runtime, "work", { outcome: "error" });
    const ack = await request(`/projects/${workspace.id}/acknowledge`, { receipt: page.receipt, events: page.events.map(({ id, revision }) => ({ id, revision })) });
    expect(ack.status).toBe(200);
    expect(await readSummary()).toMatchObject({ unread: 1, state: "attention", attention: { total: 1, review: 1 } });
    const detail = await (await request(`/projects/${workspace.id}/attention`)).json() as { items: Array<{ workItemId: string; categories: string[] }> };
    expect(detail.items).toEqual([expect.objectContaining({ workItemId: "work", categories: ["review"] })]);
    expect(runtime.prepare("SELECT resolution FROM work_items WHERE id='work'").get()).toEqual({ resolution: "open" });
    available = false;
    expect((await request(`/projects/${workspace.id}/acknowledge`, { receipt: page.receipt, events: [] })).status).toBe(503);
    available = true; expect((await readSummary()).unread).toBe(1);
  });
  it("rechecks archive after summary, rejects active/pending/unknown and restores without Focus/history loss", async () => {
    leaderItemFixture(runtime, workspace, "work"); changeItem(runtime, "work", { runtime: "inactive", outcome: "completed", resolution: "reviewed" });
    expect((await request("/focus", { expectedRevision: 0, projectIds: [workspace.id] }, "PUT")).status).toBe(200);
    expect((await readSummary()).archiveEligible).toBe(true);
    hosts.set("agent", { status: "running", role: "default", cwd: workspace.sourceRoot, runKey: "agent", taskState: null, worktree: null } as unknown as SessionHost);
    const rev = (await readLibrary()).projects[0]!.revision;
    expect((await request(`/projects/${workspace.id}/archive`, { expectedRevision: rev })).status).toBe(409);
    hosts.clear();
    changeItem(runtime, "work", { resolution: "open" });
    expect((await request(`/projects/${workspace.id}/archive`, { expectedRevision: rev })).status).toBe(409);
    changeItem(runtime, "work", { resolution: "reviewed" }); available = false;
    expect(await readSummary()).toMatchObject({ freshness: "unknown", unread: null });
    expect((await request(`/projects/${workspace.id}/archive`, { expectedRevision: rev })).status).toBe(409);
    available = true;
    const archived = await (await request(`/projects/${workspace.id}/archive`, { expectedRevision: rev })).json() as LibraryProject;
    expect(archived).toMatchObject({ archived: true, focusOrder: null });
    expect(runtime.prepare("SELECT resolution FROM work_items WHERE id='work'").get()).toEqual({ resolution: "reviewed" });
    const restore = await request(`/projects/${workspace.id}/restore`, { expectedRevision: archived.revision });
    expect(restore.status).toBe(200); expect(await restore.json()).toMatchObject({ archived: false, focusOrder: null });
    expect(fs.existsSync(path.join(workspace.sourceRoot, "keep.txt"))).toBe(true);
    expect(runtime.prepare("SELECT COUNT(*) AS n FROM library_work_events").get()).toEqual({ n: 4 });
  });
  it.each(["starting", "running", "mystery", "invalid-mode"])("rejects archive for persisted current plan authority gap: %s", async state => {
    leaderItemFixture(runtime, workspace, "work"); changeItem(runtime, "work", { runtime: "inactive", outcome: "completed", resolution: "reviewed" });
    migrateTaskGraph(runtime);
    runtime.prepare("UPDATE work_items SET current_run_key='primary' WHERE id='work'").run();
    runtime.prepare(`INSERT INTO task_graph_plan_proposals
      (id,work_item_id,primary_run_key,proposal_revision,projection_revision,state,mode,request_id,request_hash,plan_json,node_ids_json,created_at,updated_at)
      VALUES ('plan','work','primary',1,1,?,?,'request','hash','{}','{}',1,1)`)
      .run(state === "invalid-mode" ? "completed" : state, state === "invalid-mode" ? "mystery" : "confirm");
    closePersistDb(); runtime = openPersistDb(path.join(fixture.root, "server.db")); fetch = mount();
    expect(await readSummary()).toMatchObject({ freshness: "unknown", archiveEligible: false });
    const denied = await request(`/projects/${workspace.id}/archive`, { expectedRevision: 0 });
    expect(denied.status).toBe(409); expect(await denied.json()).toMatchObject({ code: "ARCHIVE_UNSAFE" });
    expect((await readLibrary()).projects[0]!.archived).toBe(false);
    runtime.prepare("UPDATE task_graph_plan_proposals SET primary_run_key='historical' WHERE id='plan'").run();
    expect((await readSummary()).archiveEligible).toBe(true);
  });
  it("independently validates auth, UUID authorization, strict writes, bounds and revision races", async () => {
    expect((await request("", undefined, "GET", false)).status).toBe(401);
    const foreign = "11111111-1111-4111-8111-111111111111";
    expect((await request(`/projects/${foreign}`, { expectedRevision: 0, tags: ["no"] }, "PATCH")).status).toBe(403);
    expect((await request("/summary", { projectIds: [foreign] })).status).toBe(403);
    expect((await request(`/projects/${workspace.id}`, { expectedRevision: 0, sourceRoot: "/etc" }, "PATCH")).status).toBe(400);
    expect((await request(`/projects/${Buffer.from(workspace.sourceRoot).toString("base64url")}`, { expectedRevision: 0 }, "PATCH")).status).toBe(400);
    expect((await request("/summary", { projectIds: Array(101).fill(workspace.id) })).status).toBe(400);
    expect((await request(`/projects/${workspace.id}/events?limit=51`)).status).toBe(400);
    expect((await request(`/projects/${workspace.id}/events?cursor=invalid`)).status).toBe(400);
    const race = await Promise.all([request(`/projects/${workspace.id}`, { expectedRevision: 0, tags: ["first"] }, "PATCH"),
      request(`/projects/${workspace.id}`, { expectedRevision: 0, tags: ["second"] }, "PATCH")]);
    expect(race.map(r => r.status).sort()).toEqual([200, 409]);
    const winningTags = (await readLibrary()).projects[0]!.tags;
    expect(winningTags.length).toBe(1);
    fs.renameSync(workspace.sourceRoot, workspace.sourceRoot + "-old");
    const escape = fs.mkdtempSync(path.join(fixture.root, "foreign-")); fs.symlinkSync(escape, workspace.sourceRoot, "dir");
    expect((await request(`/projects/${workspace.id}`, { expectedRevision: 1, tags: ["escape"] }, "PATCH")).status).toBe(403);
    expect((await readLibrary()).projects[0]!.tags).toEqual(winningTags);
  });
  it("supports authenticated restart-stable receipt subsets and never treats a tampered receipt as a read", async () => {
    leaderItemFixture(runtime, workspace, "a"); leaderItemFixture(runtime, workspace, "b");
    const page = await (await request(`/projects/${workspace.id}/events?limit=1`)).json() as LibraryEventPage;
    expect(page.events).toHaveLength(1); expect(page.nextCursor).not.toBeNull();
    closePersistDb(); runtime = openPersistDb(path.join(fixture.root, "server.db")); fetch = mount();
    const body = { receipt: page.receipt, events: page.events.map(({ id, revision }) => ({ id, revision })) };
    expect((await request(`/projects/${workspace.id}/acknowledge`, { ...body, receipt: page.receipt + "x" })).status).toBe(400);
    expect((await readSummary()).unread).toBe(2);
    expect((await request(`/projects/${workspace.id}/acknowledge`, body)).status).toBe(200);
    expect((await readSummary()).unread).toBe(1);
  });
  it("reports a Library-wide unread total and clears it with an authenticated, bounded, strict request", async () => {
    const second = workspaceFixture(fixture.root, "Second");
    leaderItemFixture(runtime, workspace, "a", 100); leaderItemFixture(runtime, second, "b", 100);
    expect((await request("/unread", undefined, "GET", false)).status).toBe(401);
    const unread = await (await request("/unread")).json() as { total: number; projects: number; asOf: number };
    expect(unread).toMatchObject({ total: 2, projects: 2 });
    expect((await request("/acknowledge-all", { asOf: unread.asOf }, "POST", false)).status).toBe(401);
    for (const bad of [{}, { asOf: -1 }, { asOf: unread.asOf, extra: true }, { asOf: unread.asOf, projectIds: [] }, { asOf: unread.asOf, projectIds: ["not-a-uuid"] }])
      expect((await request("/acknowledge-all", bad)).status).toBe(400);
    expect((await request("/acknowledge-all", { asOf: unread.asOf, projectIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(403);
    expect((await readSummary()).unread).toBe(1);
    leaderItemFixture(runtime, workspace, "late", Date.now() + 60_000);
    const scoped = await request("/acknowledge-all", { asOf: unread.asOf, projectIds: [workspace.id] });
    expect(scoped.status).toBe(200); expect(await scoped.json()).toEqual({ ok: true, cleared: 1 });
    expect((await (await request("/unread")).json() as { projects: number }).projects).toBe(1);
    const all = await request("/acknowledge-all", { asOf: unread.asOf });
    expect(await all.json()).toEqual({ ok: true, cleared: 1 });
    expect(await readSummary()).toMatchObject({ unread: 1 });
    available = false;
    expect((await request("/unread")).status).toBe(503);
    expect((await request("/acknowledge-all", { asOf: unread.asOf })).status).toBe(503);
    expect(runtime.prepare("SELECT COUNT(*) AS n FROM work_items WHERE resolution='open'").get()).toEqual({ n: 3 });
  });
});

it("serves an authenticated bounded historical activity index without runtime detail or read mutations", async () => {
  leaderItemFixture(runtime, workspace, "recent", 100);
  changeItem(runtime, "recent", { runtime: "working" }, 200);
  const before = await readSummary();
  expect((await request("/activity", { projectIds: [workspace.id] }, "POST", false)).status).toBe(401);
  const response = await request("/activity", { projectIds: [workspace.id] });
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const rows = await response.json();
  expect(rows).toEqual([expect.objectContaining({ projectId: workspace.id, recent: expect.objectContaining({ projectId: workspace.id, at: 200, unread: true }) })]);
  expect(rows[0]).not.toHaveProperty("activeLeaders");
  expect((await readSummary()).unread).toBe(before.unread);
  expect((await request("/activity", { projectIds: ["11111111-1111-4111-8111-111111111111"] })).status).toBe(403);
  expect((await request("/activity", { projectIds: Array(101).fill(workspace.id) })).status).toBe(400);
  available = false; expect((await request("/activity", { projectIds: [workspace.id] })).status).toBe(503);
});

it("returns directly navigable leader item IDs without session or transcript payloads", async () => {
  itemFixture(runtime, workspace, "leader-item", 100);
  runtime.prepare("INSERT INTO sessions(session_key,project_id,work_item_id,run_kind,run_number,role,task_state_json) VALUES ('leader-run',?,'leader-item','primary',1,'leader','private task payload')").run(workspace.id);
  const response = await request("/activity", { projectIds: [workspace.id] });
  expect(response.status).toBe(200);
  const [row] = await response.json();
  expect(row.leaders).toEqual([{ workItemId: "leader-item", title: "Work leader-item", at: 100 }]);
  expect(JSON.stringify(row)).not.toContain("private task payload");
  expect(runtime.prepare("SELECT COUNT(*) AS n FROM library_ack").get()).toEqual({ n: 0 });
});

it("degrades only changed sources in a mixed summary batch without relaxing registration or write authorization", async () => {
  const sibling = workspaceFixture(fixture.root, "Valid sibling");
  fs.renameSync(workspace.sourceRoot, workspace.sourceRoot + "-old");
  fs.symlinkSync(sibling.sourceRoot, workspace.sourceRoot, "dir");
  const response = await request("/summary", { projectIds: [workspace.id, sibling.id] });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    expect.objectContaining({ projectId: workspace.id, state: "unknown", freshness: "unknown", unread: null, archiveEligible: false }),
    expect.objectContaining({ projectId: sibling.id, state: "up_to_date", freshness: "fresh", archiveEligible: true }),
  ]);
  const foreign = "11111111-1111-4111-8111-111111111111";
  const denied = await request("/summary", { projectIds: [workspace.id, sibling.id, foreign] });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "NOT_REGISTERED" });
  const write = await request(`/projects/${workspace.id}`, { expectedRevision: 0, tags: ["escape"] }, "PATCH");
  expect(write.status).toBe(403);
  expect(await write.json()).toMatchObject({ code: "SOURCE_CHANGED" });
});


it("reports corrupt Library as unavailable without bypassing HTTP authentication or replacing data", async () => {
  const file = path.join(fixture.home, "project-library.db");
  const corrupt = Buffer.from("not SQLite: retained Library recovery data");
  fs.writeFileSync(file, corrupt);
  expect((await request("", undefined, "GET", false)).status).toBe(401);
  for (const [route, body] of [["", undefined], ["/summary", { projectIds: [workspace.id] }],
    [`/projects/${workspace.id}/archive`, { expectedRevision: 0 }]] as const) {
    const response = await request(route, body);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "LIBRARY_UNAVAILABLE" });
    expect(fs.readFileSync(file)).toEqual(corrupt);
  }
});
