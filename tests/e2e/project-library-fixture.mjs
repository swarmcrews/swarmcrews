import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { expect } from "@playwright/test";
import { connectTaskGraphSocket, sendCommand } from "./task-graph-harness.mjs";

export const libraryRoot = "/api/projects/library";
export const longName = "Repository".repeat(18);
export const longPath = "/workspace/" + "unbroken-folder".repeat(24);
export function libraryProject(project = {}) {
  const id = project.id ?? randomUUID();
  const source = project.path ?? `/workspace/${id}`;
  return { id, workspaceId: id, sourceRoot: source, path: source, name: "Repository",
    displayName: null, description: "", tags: [], collectionIds: [], archived: false,
    focusOrder: null, revision: 0, createdAt: "2026-01-01T00:00:00.000Z", lastOpened: null, ...project };
}
export function quietSummary(projectId, patch = {}) {
  return { projectId, freshness: "fresh", checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 15000).toISOString(), state: "up_to_date",
    activeLeaders: 0, activeCrew: 0, activeOther: 0, activeWorkItems: 0,
    attention: { total: 0, decision: 0, review: 0, conflict: 0 }, unread: 0,
    recent: null, archiveEligible: true, ...patch };
}
export function contextEvent(projectId, text = "Project context updated") {
  return { id: randomUUID(), revision: 0, projectId, workItemId: null, kind: "context",
    text, at: Date.now(), unread: true, destination: { view: "context" } };
}
export const card = (page, name) => page.getByRole("article", { name, exact: true });
export const details = (page, name) => card(page, name).getByRole("button", { name: `Details and organization for ${name}`, exact: true });
export async function openDetails(page, name) {
  await details(page, name).focus(); // Keyboard focus also reveals secondary card actions.
  await details(page, name).click();
  const dialog = page.getByRole("dialog", { name: `${name}`, exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
export async function refreshLibrary(page) {
  const tools = page.locator("details.pl-tools");
  if (await tools.isVisible() && await tools.getAttribute("open") === null) await tools.locator("summary").click();
  await page.getByRole("button", { name: "Refresh Library", exact: true }).click();
}
export async function returnToLibrary(page) {
  await page.locator(".project-header").getByRole("button", { name: "All projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^(Project Library|Focus desk|Archived projects)$/, level: 1 })).toBeVisible();
}
export async function choosePath(page, source, { register = true, name } = {}) {
  const toggle = page.getByRole("button", { name: "Add repository" });
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  await page.getByRole("button", { name: register ? "Register repository" : "Open repository", exact: true }).click();
  const browser = page.getByRole("combobox", { name: "Search folders" });
  if (await browser.isVisible()) await browser.press("Escape");
  await page.getByRole("button", { name: "Enter a path instead" }).click();
  await page.getByRole("textbox", { name: "Repository path", exact: true }).fill(source);
  await page.getByRole("button", { name: "Use this path" }).click();
  if (register && name) await page.getByRole("textbox", { name: "Project name", exact: true }).fill(name);
}

// Runner-only real service fixture: filesystem paths are confined to the disposable
// HOME already supplied by browser-config. No routes, application modules or providers are mocked.
export function disposableSource(label) {
  const home = process.env.MINIONS_E2E_HOME;
  if (!home) throw new Error("MINIONS_E2E_HOME is required; run via authorized browser runner");
  return path.join(home, `library-${label}-${randomUUID()}`);
}
export async function realApi(page) {
  const auth = await page.request.get("/api/auth/token"); expect(auth.ok()).toBe(true);
  const { token } = await auth.json();
  return async (method, route, data, status = 200) => {
    const response = await page.request.fetch(route, { method, headers: { Authorization: `Bearer ${token}` }, ...(data === undefined ? {} : { data }) });
    expect(response.status(), `${method} ${route}: ${await response.text()}`).toBe(status);
    return response.json();
  };
}
export async function registerReal(page, name) {
  const api = await realApi(page); const source = disposableSource("real");
  const project = await api("POST", "/api/projects", { path: source, name, gitAction: "initialize" }, 201);
  return { project, source, api };
}
export async function realWorkItem(page, project, title) {
  await connectTaskGraphSocket(page, project.id);
  const reply = await sendCommand(page, { type: "create_work_item", requestId: randomUUID(),
    workspaceId: project.workspaceId ?? project.id, title, changeMode: "live" });
  expect(reply.result.workItem.id).toBeTruthy(); return reply.result.workItem;
}
// Explicit persisted-state seed, NOT simulated HTTP and NOT proof of UI lifecycle
// transitions: real SQLite triggers and real REST read/ack/archive execute thereafter.
export function runtimeDb(action) {
  const home = process.env.MINIONS_E2E_HOME; const file = process.env.MINIONS_E2E_DB;
  if (!home || !file || !path.resolve(file).startsWith(path.resolve(home) + path.sep)) throw new Error("Disposable runner DB required");
  const db = new Database(file); db.pragma("busy_timeout = 5000");
  try { return action(db); } finally { db.close(); }
}
export function changeRealItem(id, patch) {
  const allowed = new Set(["runtime_state", "outcome", "resolution", "integration_state", "wait_kind"]);
  for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`Unsupported seed field ${key}`);
  runtimeDb(db => db.prepare(`UPDATE work_items SET ${Object.keys(patch).map(key => `${key}=?`).join(",")}, lifecycle_revision=lifecycle_revision+1,updated_at=? WHERE id=?`).run(...Object.values(patch), Date.now(), id));
}
export function itemEvidence(id) { return runtimeDb(db => db.prepare("SELECT * FROM work_items WHERE id=?").get(id)); }
export function runCount(projectId) { return runtimeDb(db => db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE project_id=? OR work_item_id IN (SELECT id FROM work_items WHERE project_id=?)").get(projectId, projectId).n); }
export function assertSource(source, expected) { expect(fs.readFileSync(path.join(source, "keep.txt"), "utf8")).toBe(expected); }

// Minimal ingress migration for legacy E2E fixtures. It changes only the two new
// list endpoints; existing workspace/session/operational assertions remain authoritative.
export async function legacyLibraryRoutes(page, projects) {
  const records = projects.map(libraryProject);
  await page.route("**/api/projects/library", route => route.fulfill({ json: { projects: records, collections: [], focusRevision: 0 } }));
  await page.route("**/api/projects/library/summary", route => route.fulfill({ json: route.request().postDataJSON().projectIds.map(id => quietSummary(id)) }));
}

// Deterministic HTTP/WS boundary only; all in-memory mutations deliberately do
// not count as persistence evidence. Unknown endpoints fail loudly rather than
// inventing quiet/workspace state. Holds let tests race transitions without sleeps.
export async function boundaryLibrary(page, { projects = [libraryProject({ name: "Atlas" })], collections = [], summary = {}, sessions = [], workItems = [] } = {}) {
  const library = { projects: structuredClone(projects), collections: structuredClone(collections), focusRevision: 0 };
  const calls = []; const commands = []; const failures = new Map(); const holds = new Map();
  const leaderPreviews = new Map(projects.map(p => [p.id, []]));
  const events = new Map(projects.map(p => [p.id, []])); const attention = new Map(projects.map(p => [p.id, []]));
  const summaryPatches = new Map(Object.entries(summary)); const receipts = new Map();
  const workspaces = new Map(projects.map(p => [p.id, { ...p, nodes: [], graph: { edges: [] }, settings: {}, skills: [], context: "", transform: { x: 0, y: 0, scale: 1 }, hasSidecar: true }]));
  let readiness = { schemaVersion: 1, ready: true, readyHarnesses: [], harnesses: [] };
  let git = { isRepository: true };
  const summaryFor = id => {
    const rows = events.get(id) ?? [];
    const unread = rows.filter(e => e.unread).length;
    const patch = summaryPatches.get(id) ?? {};
    return quietSummary(id, { unread, recent: rows.at(-1) ?? null, ...(unread ? { state: "new" } : {}), ...patch });
  };
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method(); const pathname = url.pathname;
    const body = request.postData() ? request.postDataJSON() : null; const key = `${method} ${pathname}`;
    calls.push({ key, pathname, method, body, search: url.search });
    if (holds.has(key)) await holds.get(key);
    if (failures.has(key)) { const fault = failures.get(key); return route.fulfill({ status: fault.status ?? 503, json: { code: fault.code ?? "STATE_UNAVAILABLE", error: fault.error ?? fault } }); }
    const ok = json => route.fulfill({ json });
    if (pathname === "/api/auth/token") return ok({ token: "library-boundary" });
    if (pathname === "/api/readiness") return ok(readiness);
    if (pathname === "/api/projects/git-status") return ok(git);
    if (pathname === "/api/projects/path-suggestions") return ok({ platform: "posix", separator: "/", roots: [], directory: null, parent: null, breadcrumbs: [], entries: [], truncated: false });
    if (pathname === libraryRoot && method === "GET") return ok(library);
    if (pathname === `${libraryRoot}/activity`) {
      const now = await page.evaluate(() => Date.now());
      return ok(body.projectIds.map(projectId => ({ projectId, recent: (events.get(projectId) ?? []).slice().sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0] ?? null, leaders: leaderPreviews.get(projectId) ?? [], checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30000).toISOString() })));
    }
    if (pathname === `${libraryRoot}/summary`) {
      const now = await page.evaluate(() => Date.now());
      return ok(body.projectIds.map(id => ({ ...summaryFor(id), checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15000).toISOString() })));
    }
    if (pathname === `${libraryRoot}/focus`) {
      if (body.expectedRevision !== library.focusRevision) return route.fulfill({ status: 409, json: { code: "REVISION_CONFLICT", error: "Focus changed" } });
      library.focusRevision++; for (const p of library.projects) { const index = body.projectIds.indexOf(p.id); p.focusOrder = index < 0 ? null : index; p.revision++; } return ok(library);
    }
    if (pathname === `${libraryRoot}/collections` && method === "POST") { const c = { id: randomUUID(), name: body.name }; library.collections.push(c); return ok(c); }
    if (pathname === `${libraryRoot}/unread`) {
      const counts = library.projects.map(p => (events.get(p.id) ?? []).filter(e => e.unread).length).filter(n => n > 0);
      return ok({ total: counts.reduce((sum, n) => sum + n, 0), projects: counts.length, asOf: Date.now() });
    }
    if (pathname === `${libraryRoot}/acknowledge-all`) {
      let cleared = 0;
      for (const id of body.projectIds ?? library.projects.map(p => p.id)) for (const e of events.get(id) ?? []) if (e.unread && e.at <= body.asOf) { e.unread = false; cleared++; }
      return ok({ ok: true, cleared });
    }
    const collectionMatch = pathname.match(/\/library\/collections\/([^/]+)$/);
    if (collectionMatch) {
      const id = collectionMatch[1]; const c = library.collections.find(c => c.id === id);
      if (method === "PATCH") { c.name = body.name; return ok(c); }
      if (method === "DELETE") { library.collections = library.collections.filter(c => c.id !== id); library.projects.forEach(p => { p.collectionIds = p.collectionIds.filter(value => value !== id); }); return ok({ ok: true }); }
    }
    const match = pathname.match(/\/library\/projects\/([^/]+)(?:\/(events|attention|acknowledge|archive|restore))?$/);
    if (match) {
      const [, id, action] = match; const p = library.projects.find(p => p.id === id);
      if (!p) return route.fulfill({ status: 404, json: { code: "NOT_FOUND", error: "Project unavailable" } });
      if (action === "events") {
        const rows = [...(events.get(id) ?? [])].reverse().sort((a, b) => b.at - a.at); const offset = Number(url.searchParams.get("cursor") ?? 0); const limit = Number(url.searchParams.get("limit") ?? 50);
        const shown = structuredClone(rows.slice(offset, offset + limit)); const receipt = randomUUID(); receipts.set(receipt, { id, shown });
        return ok({ events: shown, receipt, nextCursor: rows.length > offset + limit ? String(offset + limit) : null });
      }
      if (action === "attention") return ok({ items: attention.get(id) ?? [], nextCursor: null });
      if (action === "acknowledge") {
        const receipt = receipts.get(body.receipt);
        expect(receipt?.id).toBe(id);
        for (const ref of body.events) {
          expect(receipt.shown.some(e => e.id === ref.id && e.revision === ref.revision)).toBe(true);
          const event = events.get(id).find(e => e.id === ref.id && e.revision === ref.revision); if (event) event.unread = false;
        }
        return ok({ ok: true });
      }
      if (method === "PATCH" || action === "archive" || action === "restore") {
        if (body.expectedRevision !== p.revision) return route.fulfill({ status: 409, json: { code: "REVISION_CONFLICT", error: "Metadata changed" } });
        if (action === "archive" && !summaryFor(id).archiveEligible) return route.fulfill({ status: 409, json: { code: "ARCHIVE_UNSAFE", error: "Work arrived; archive blocked" } });
        if (action === "archive" || action === "restore") { p.archived = action === "archive"; p.focusOrder = null; }
        else { Object.assign(p, body); p.name = body.displayName ?? p.name; }
        p.revision++; return ok(p);
      }
    }
    if (pathname === "/api/projects" && method === "GET") return ok([...workspaces.values()]);
    if (pathname === "/api/projects/open" || (pathname === "/api/projects" && method === "POST")) return ok([...workspaces.values()][0]);
    const id = pathname.split("/")[3]; const workspace = workspaces.get(id);
    if (workspace && pathname === `/api/projects/${id}`) { if (method === "PUT") Object.assign(workspace, body); return ok(workspace); }
    if (workspace && pathname.endsWith("/context")) { if (method === "PUT") workspace.context = body.content; return ok({ content: workspace.context }); }
    if (workspace && pathname.endsWith("/state")) { Object.assign(workspace, body); return ok({ ok: true }); }
    if (pathname.includes("skills")) return ok([]);
    if (pathname.endsWith("/settings")) return ok({});
    if (pathname.endsWith("/mcp-servers")) return ok({ entries: [], statuses: {}, invalid: [] });
    return route.fulfill({ status: 501, json: { error: `Unmodeled boundary ${key}` } });
  });
  await page.routeWebSocket("**/ws*", socket => socket.onMessage(raw => {
    const message = JSON.parse(raw); commands.push(message);
    const send = data => socket.send(JSON.stringify({ topic: "global", ...data }));
    if (message.type === "list_sessions") send({ type: "session_list", topic: message.projectId ? `project:${message.projectId}` : "global", sessions: sessions.filter(s => !message.projectId || s.projectId === message.projectId), includeArchived: message.includeArchived === true });
    if (message.type === "list_harnesses") send({ type: "harness_list", harnesses: [] });
    if (message.type === "list_work_items") send({ type: "work_item_response", command: message.type, requestId: message.requestId, success: true, result: { projectId: message.projectId, items: workItems.filter(w => w.projectId === message.projectId), nextCursor: null } });
    if (message.type === "get_work_item") { const workItem = workItems.find(w => w.id === message.workItemId); send({ type: "work_item_response", command: message.type, requestId: message.requestId, success: !!workItem, result: workItem ? { workItem, bindings: [], currentRun: null, runs: [], nextCursor: null, integration: null } : null, ...(!workItem ? { error: "Work item unavailable", code: "not_found" } : {}) }); }
  }));
  return { library, calls, commands, failures, events, leaderPreviews, attention, summaryPatches, workspaces,
    setReadiness(value) { readiness = value; }, setGit(value) { git = value; },
    hold(key) { let release; holds.set(key, new Promise(resolve => { release = resolve; })); return () => { holds.delete(key); release(); }; },
    async goto(url = "/?view=desktop") { await page.goto(url); await expect(page.getByRole("heading", { name: "Project Library", exact: true })).toBeVisible(); },
  };
}
export function expectNoExecution(fixture) {
  expect(fixture.commands.filter(c => /^(?:start|create_session|continue_work_item|reply|stop|cancel|approve|merge|review_work_item|promote|enqueue)/.test(c.type))).toEqual([]);
  expect(fixture.calls.filter(c => c.method === "DELETE" && !c.pathname.includes("/library/collections/"))).toEqual([]);
}
