import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { libraryRoot, libraryProject, boundaryLibrary, card, details, openDetails, returnToLibrary,
  refreshLibrary, choosePath, disposableSource, realApi, registerReal, realWorkItem, changeRealItem,
  itemEvidence, runCount, assertSource, contextEvent, expectNoExecution, longName, longPath } from "./project-library-fixture.mjs";

test.use({ viewport: { width: 1440, height: 900 } });

// [REAL] means real server/registry/SQLite/FS; isolated HTTP faults and direct
// lifecycle seeds are called out locally. No real provider is ever started here.
test("S1 [boundary] empty Library and readiness retry keep registration inputs", async ({ page }) => {
  const f = await boundaryLibrary(page, { projects: [] });
  f.setReadiness({ schemaVersion: 1, ready: false, readyHarnesses: [], harnesses: [] });
  await f.goto(); await expect(page.getByRole("heading", { name: "Start with a project" })).toBeVisible();
  await choosePath(page, "/workspace/new-destination", { name: "Kept name" });
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Sign in");
  f.setReadiness({ schemaVersion: 1, ready: true, readyHarnesses: [], harnesses: [] });
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Kept name");
  expect(f.calls.filter(c => c.key === "POST /api/projects")).toEqual([]); expectNoExecution(f);
});

for (const gitChoice of ["initialize", "continue_without_git"]) test(`S1 [REAL] register new destination with explicit ${gitChoice}, recover and deduplicate`, async ({ page }) => {
  const api = await realApi(page); const source = disposableSource(gitChoice); const name = `Library ${gitChoice}`;
  await page.goto("/?view=desktop"); await choosePath(page, source, { name });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("button", { name: "Initialize Git & create first commit" })).toBeVisible();
  const createdResponse = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/projects" && r.status() === 201);
  await page.getByRole("button", { name: gitChoice === "initialize" ? "Initialize Git & create first commit" : /Continue without Git/i }).click();
  const created = await (await createdResponse).json();
  await expect(page.locator(".project-header")).toContainText(name);
  expect(fs.existsSync(path.join(source, ".git"))).toBe(gitChoice === "initialize");
  await api("PUT", `/api/projects/${created.id}/context`, { content: "Persisted registration context" });
  await api("PUT", `/api/projects/${created.id}/state`, { nodes: [{ id: "preserved-note", type: "markdown", position: { x: 10, y: 20 }, size: { width: 300, height: 220 }, data: { title: "Retained note", content: "Do not replace my Canvas", viewMode: "preview" } }] });
  const before = await api("GET", `/api/projects/${created.id}`);
  const duplicate = await api("POST", "/api/projects", { path: source, name: "Must not replace history", gitAction: gitChoice });
  expect(duplicate.id).toBe(created.id); expect(duplicate.workspaceId).toBe(created.workspaceId);
  expect(duplicate.nodes).toEqual(before.nodes); expect(duplicate.context).toBe("Persisted registration context");
  expect((await api("GET", libraryRoot)).projects.filter(p => p.path === source)).toHaveLength(1);
  await page.reload(); await expect(page.locator(".project-header")).toContainText(name);
  await returnToLibrary(page); await page.getByRole("searchbox", { name: "Search projects" }).fill(name);
  await card(page, name).getByRole("button", { name: `Open ${name}`, exact: true }).click();
  await expect(page.getByRole("main", { name: "Activity workspace" })).toBeVisible();
  expect(runCount(created.id)).toBe(0);
});

test("S1 [REAL + HTTP fault] existing folder registration failure preserves path/name; retry creates one UUID", async ({ page }) => {
  const api = await realApi(page); const source = disposableSource("existing"); fs.mkdirSync(source); fs.writeFileSync(path.join(source, "keep.txt"), "existing source");
  await page.goto("/?view=desktop"); await choosePath(page, source, { name: "Retry existing folder" });
  await page.route("**/api/projects", route => route.request().method() === "POST"
    ? route.fulfill({ status: 503, json: { error: "Injected registration outage" } }) : route.fallback());
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: /Continue without Git/i }).click();
  await expect(page.getByRole("alert")).toContainText("Injected registration outage");
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Retry existing folder");
  await expect(page.locator(".repository-path-picker__value")).toHaveText(source);
  expect((await api("GET", libraryRoot)).projects.filter(p => p.path === source)).toEqual([]);
  await page.unroute("**/api/projects");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("button", { name: /Continue without Git/i }).click();
  await expect(page.locator(".project-header")).toContainText("Retry existing folder");
  const registered = (await api("GET", libraryRoot)).projects.filter(p => p.path === source);
  expect(registered).toHaveLength(1); assertSource(source, "existing source");
  await returnToLibrary(page); await choosePath(page, source, { register: false });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("button", { name: /Continue without Git/i }).click();
  await expect(page.locator(".project-header")).toContainText("Retry existing folder");
  expect((await api("GET", libraryRoot)).projects.filter(p => p.path === source).map(p => p.id)).toEqual([registered[0].id]);
});

test("S2 [boundary] names/paths/tags, collection intersection, sorting, compact index and return preserve identity", async ({ page }) => {
  const group = { id: "clients", name: "Clients" };
  const a = libraryProject({ name: "Duplicate", path: "/workspace/client-alpha", tags: ["client"], collectionIds: [group.id], lastOpened: "2026-03-01T00:00:00Z" });
  const b = libraryProject({ name: "Duplicate", path: "/workspace/client-beta", tags: ["client"], collectionIds: [group.id], lastOpened: "2026-04-01T00:00:00Z" });
  const z = libraryProject({ name: longName, path: longPath, tags: ["personal"], createdAt: "2026-05-01T00:00:00Z" });
  const f = await boundaryLibrary(page, { projects: [a, b, z], collections: [group] }); await f.goto();
  await page.getByLabel("Sort projects", { exact: true }).selectOption("activity");
  await expect(page.locator(".pl-index-row .pl-index-path")).toHaveText(["client-beta", "client-alpha"]);
  expect(await page.locator(".pl-index-row .pl-index-name").evaluateAll(els => els.map(el => el.title))).toEqual([b.path, a.path, z.path]);
  await page.getByLabel("Sort projects", { exact: true }).selectOption("created");
  expect(await page.locator(".pl-index-row .pl-index-name").evaluateAll(els => els.map(el => el.title))).toEqual([z.path, ...[a, b].sort((x, y) => x.id.localeCompare(y.id)).map(p => p.path)]);
  await page.getByLabel("Sort projects", { exact: true }).selectOption("name");
  await expect(page.locator(".pl-index-row .pl-index-name")).toHaveText(["Duplicate", "Duplicate", longName]);
  await page.getByRole("searchbox", { name: "Search projects" }).fill("client");
  await page.getByLabel("Collection", { exact: true }).selectOption(group.id);
  await page.getByLabel("Tag", { exact: true }).selectOption("client");
  await expect(page.locator(".pl-project-index")).toBeVisible();
  const alpha = page.getByRole("article", { name: "Duplicate", exact: true }).filter({ has: page.getByText("client-alpha", { exact: true }) });
  await alpha.getByRole("button", { name: "Open Duplicate", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`project=${a.id}`));
  await returnToLibrary(page); await expect(page.getByRole("searchbox", { name: "Search projects" })).toHaveValue("client");
  await expect(page.getByLabel("Collection", { exact: true })).toHaveValue(group.id); await expect(page.getByLabel("Tag", { exact: true })).toHaveValue("client");
  await expect(page.locator(".pl-project-index")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search projects" }).fill("no such project");
  await expect(page.getByRole("heading", { name: "No matching projects" })).toBeVisible();
  await page.getByRole("button", { name: "Clear search and filters" }).click(); await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.locator(".pl-project-index")).toBeVisible(); expectNoExecution(f);
});

test("S2 [REAL] durable Library is not the 20-recents cache; oldest UUID remains openable after reload", async ({ page }) => {
  const api = await realApi(page); const registered = [];
  for (let i = 0; i < 22; i++) {
    registered.push(await api("POST", "/api/projects", { path: disposableSource("over-recents"), name: `Durable count ${i}`, gitAction: "continue_without_git" }, 201));
  }
  const oldest = registered[0]; const library = await api("GET", libraryRoot);
  for (const p of registered) expect(library.projects.some(record => record.id === p.id)).toBe(true);
  await page.goto("/?view=desktop"); await page.getByRole("searchbox", { name: "Search projects" }).fill(oldest.path);
  await expect(card(page, oldest.name)).toBeVisible(); await page.reload(); await expect(card(page, oldest.name)).toBeVisible();
  await card(page, oldest.name).getByRole("button", { name: `Open ${oldest.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${oldest.id}`)); await expect(page.locator(".project-header")).toContainText(oldest.name);
  expect(runCount(oldest.id)).toBe(0);
});

test("S3 [REAL + HTTP fault] collection CRUD, staged metadata, discard/save/retry and browser reload persistence", async ({ page }) => {
  const { project, api, source } = await registerReal(page, "Metadata origin"); fs.writeFileSync(path.join(source, "keep.txt"), "source must remain");
  await page.goto("/?view=desktop"); await page.getByLabel("Library tools", { exact: true }).click();
  await page.getByRole("button", { name: "Manage collections" }).click();
  let dialog = page.getByRole("dialog", { name: "Collections", exact: true });
  await dialog.getByRole("textbox", { name: "New collection name" }).fill("Clients"); await dialog.getByRole("button", { name: "Create collection" }).click();
  await expect(dialog.getByRole("button", { name: "Rename Clients" })).toBeVisible();
  await dialog.getByRole("button", { name: "Rename Clients" }).click(); await dialog.getByRole("textbox", { name: "Collection name", exact: true }).fill("Customers");
  await dialog.getByRole("button", { name: "Save collection name" }).click(); await expect(dialog.getByRole("button", { name: "Rename Customers" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "New collection name" }).fill("Many-to-many");
  await dialog.getByRole("button", { name: "Create collection" }).click();
  await expect(dialog.getByRole("button", { name: "Rename Many-to-many" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await openDetails(page, "Metadata origin"); dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Repository path" })).toHaveCount(0);
  await dialog.getByRole("textbox", { name: "Display name", exact: true }).fill("Discarded");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Unsaved changes"); await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Discarded");
  await dialog.getByRole("button", { name: "Discard changes" }).click(); await expect(dialog.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Metadata origin");
  await dialog.getByRole("textbox", { name: "Display name", exact: true }).fill("Saved identity");
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("A staged description");
  await dialog.getByRole("textbox", { name: "Add tag", exact: true }).fill("client, priority"); await dialog.getByRole("checkbox", { name: "Customers" }).check();
  await dialog.getByRole("checkbox", { name: "Many-to-many" }).check();
  const endpoint = `${libraryRoot}/projects/${project.id}`;
  await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, json: { code: "LIBRARY_UNAVAILABLE", error: "Injected metadata failure" } }));
  await dialog.getByRole("button", { name: "Save changes" }).click(); await expect(dialog.getByRole("alert")).toContainText("Your edits are preserved");
  await expect(dialog.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Saved identity");
  expect((await api("GET", libraryRoot)).projects.find(p => p.id === project.id).displayName).toBeNull();
  await page.unroute(`**${endpoint}`); await dialog.getByRole("button", { name: "Retry save" }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await page.reload();
  await openDetails(page, "Saved identity"); dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("A staged description");
  await expect(dialog.getByRole("checkbox", { name: "Customers" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Many-to-many" })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Remove tag client", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove tag priority", exact: true })).toBeVisible();
  await dialog.getByRole("checkbox", { name: "Customers" }).uncheck(); await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Customers" }).check(); await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled(); await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByLabel("Library tools", { exact: true }).click();
  await page.getByRole("button", { name: "Manage collections" }).click(); dialog = page.getByRole("dialog", { name: "Collections", exact: true });
  await dialog.getByRole("button", { name: "Delete Customers" }).click(); await dialog.getByRole("button", { name: "Confirm delete collection" }).click();
  await expect(dialog.getByRole("button", { name: "Delete Customers" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await page.reload();
  const saved = (await api("GET", libraryRoot)).projects.find(p => p.id === project.id);
  expect(saved).toMatchObject({ id: project.id, path: source, displayName: "Saved identity", tags: ["client", "priority"] });
  const remainingGroup = (await api("GET", libraryRoot)).collections.find(c => c.name === "Many-to-many");
  expect(saved.collectionIds).toEqual([remainingGroup.id]);
  assertSource(source, "source must remain"); expect(runCount(project.id)).toBe(0);
});

test("S3 [boundary] revision conflict refresh preserves metadata draft and uses the new fence", async ({ page }) => {
  const p = libraryProject({ name: "Atlas" }); const f = await boundaryLibrary(page, { projects: [p] }); await f.goto();
  const dialog = await openDetails(page, p.name); await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("My unsaved edit");
  f.library.projects[0].revision = 3;
  await dialog.getByRole("button", { name: "Save changes" }).click(); await expect(dialog.getByRole("alert")).toContainText("Latest revision loaded");
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("My unsaved edit");
  await dialog.getByRole("button", { name: "Retry save" }).click(); await expect(dialog.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();
  expect(f.calls.filter(c => c.method === "PATCH").map(c => c.body.expectedRevision)).toEqual([0, 3]); expectNoExecution(f);
});

test("S4 [REAL] Focus add/reorder/remove survives reload without executing; Canvas draft guards project switch", async ({ page }) => {
  const a = await registerReal(page, "Focus Alpha"); const b = await registerReal(page, "Focus Beta");
  await page.goto("/?view=desktop");
  for (const name of [a.project.name, b.project.name]) { const d = await openDetails(page, name); await d.getByRole("button", { name: "Add to desk" }).click(); await expect(d.getByRole("button", { name: "Remove from desk" })).toBeVisible(); await d.getByRole("button", { name: "Close", exact: true }).click(); }
  await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Focus desk", exact: true }).click();
  await page.getByRole("button", { name: "Move Focus Beta earlier" }).focus();
  await page.getByRole("button", { name: "Move Focus Beta earlier" }).click(); await expect(page.locator(".pl-card .pl-name")).toHaveText(["Focus Beta", "Focus Alpha"]);
  await page.reload(); await expect(page.locator(".pl-card .pl-name")).toHaveText(["Focus Beta", "Focus Alpha"]);
  await page.getByRole("button", { name: "Remove Focus Beta from desk" }).click(); await expect(card(page, "Focus Beta")).toHaveCount(0);
  const entry = card(page, "Focus Alpha").locator(".."); await entry.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Canvas", exact: true })).toHaveAttribute("aria-selected", "true");
  const draft = page.getByRole("textbox", { name: "Context description", exact: true }); await draft.fill("Never silently lose this Alpha draft");
  await page.getByRole("tab", { name: "Activity", exact: true }).click(); await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  await expect(draft).toHaveValue("Never silently lose this Alpha draft");
  await page.locator(".project-switcher__trigger").click(); await page.getByRole("menuitemradio", { name: /Focus Beta/ }).click();
  const guard = page.getByRole("dialog", { name: "Keep your unsaved work" }); await expect(guard).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`project=${a.project.id}`)); await guard.getByRole("button", { name: "Keep editing" }).click();
  await expect(draft).toHaveValue("Never silently lose this Alpha draft"); await draft.fill("");
  await page.locator(".project-switcher__trigger").click(); await page.getByRole("menuitemradio", { name: /Focus Beta/ }).click();
  await expect(page.locator(".project-header")).toContainText("Focus Beta");
  await returnToLibrary(page); await expect(page.getByRole("heading", { name: "Focus desk", exact: true })).toBeVisible();
  await card(page, "Focus Alpha").getByRole("button", { name: "Open Focus Alpha", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Canvas", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(runCount(a.project.id)).toBe(0); expect(runCount(b.project.id)).toBe(0);
  const persisted = await a.api("GET", libraryRoot); expect(persisted.projects.find(p => p.id === b.project.id)).toMatchObject({ archived: false, focusOrder: null });
});

test("S4 [REAL] browser Back/Forward returns exact Activity item; missing ID has explicit fallback, not another run", async ({ page }) => {
  const { project } = await registerReal(page, "Navigation history"); await page.goto("/?view=desktop");
  const item = await realWorkItem(page, project, "Exact durable item");
  await page.getByRole("searchbox", { name: "Search projects" }).fill("Navigation history");
  await page.goto(`/?view=desktop&project=${project.id}&surface=activity&workItem=${item.id}`);
  await expect(page.locator(".act-main")).toContainText("Exact durable item");
  await returnToLibrary(page); await expect(page.getByRole("searchbox", { name: "Search projects" })).toHaveValue("Navigation history");
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`workItem=${item.id}`)); await expect(page.locator(".act-main")).toContainText("Exact durable item");
  await page.goForward(); await expect(page.getByRole("heading", { name: "Project Library" })).toBeVisible();
  await page.goto(`/?view=desktop&project=${project.id}&surface=activity&workItem=missing-item`);
  await expect(page.getByRole("status").filter({ hasText: "another run was not substituted" })).toBeVisible();
  await page.getByRole("button", { name: "Use project Activity" }).click(); await expect(page.getByRole("main", { name: "Activity workspace" })).toBeVisible();
});

for (const missing of ["archived", "removed"]) test(`S4 [boundary] ${missing} project return resolves to explicit Library fallback, not another UUID`, async ({ page }) => {
  const p = libraryProject({ name: "Original project" }); const other = libraryProject({ name: "Other project" });
  const f = await boundaryLibrary(page, { projects: [p, other] });
  if (missing === "archived") f.library.projects[0].archived = true;
  else f.library.projects.splice(0, 1);
  await f.goto(`/?view=desktop&project=${p.id}&surface=activity&workItem=old-work`);
  await expect(page.getByRole("alert")).toContainText("unavailable or archived");
  await expect(page.locator(".project-header")).toHaveCount(0);
  expect(f.calls.filter(c => c.key === `GET /api/projects/${other.id}`)).toEqual([]); expectNoExecution(f);
});

test("S5 [REAL DB-seeded lifecycle + HTTP fault] read only shown receipts; pending review and concurrent arrivals survive", async ({ page }) => {
  const { project, api } = await registerReal(page, "Unread review"); await page.goto("/?view=desktop");
  const item = await realWorkItem(page, project, "Result still requires review");
  changeRealItem(item.id, { runtime_state: "inactive", outcome: "completed", resolution: "open" });
  await refreshLibrary(page);
  const summaryBefore = (await api("POST", `${libraryRoot}/summary`, { projectIds: [project.id] }))[0];
  expect(summaryBefore).toMatchObject({ state: "attention", attention: { total: 1, review: 1 } }); expect(summaryBefore.unread).toBeGreaterThan(0);
  await card(page, "Unread review").getByRole("button", { name: /new updates for/ }).click();
  const dialog = page.getByRole("dialog", { name: "Updates · Unread review" });
  await expect(dialog.getByRole("region", { name: "Work needing attention" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Open Activity", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mark all read" })).toBeEnabled();
  const shown = await api("GET", `${libraryRoot}/projects/${project.id}/events`);
  const before = itemEvidence(item.id); expect((await api("POST", `${libraryRoot}/summary`, { projectIds: [project.id] }))[0].unread).toBe(summaryBefore.unread);
  // Real material arrival after the browser obtained its signed receipt.
  await api("PUT", `/api/projects/${project.id}/context`, { content: "Concurrent update not shown in that receipt" });
  const endpoint = `${libraryRoot}/acknowledge-all`;
  await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, json: { code: "STATE_UNAVAILABLE", error: "Injected ack failure" } }));
  await dialog.getByRole("button", { name: "Mark all read" }).click(); await expect(dialog.getByRole("alert")).toContainText("Injected ack failure");
  expect((await api("POST", `${libraryRoot}/summary`, { projectIds: [project.id] }))[0].unread).toBe(summaryBefore.unread + 1);
  await page.unroute(`**${endpoint}`);
  const ackResponse = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.ok());
  await dialog.getByRole("button", { name: "Mark all read" }).click();
  expect((await ackResponse).request().postDataJSON()).toEqual({ asOf: Math.max(...shown.events.map(e => e.at)), projectIds: [project.id] });
  const after = (await api("POST", `${libraryRoot}/summary`, { projectIds: [project.id] }))[0];
  expect(after).toMatchObject({ unread: 1, state: "attention", attention: { total: 1, review: 1 } }); expect(itemEvidence(item.id)).toEqual(before);
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(card(page, "Unread review").getByRole("button", { name: "1 new updates for Unread review" })).toBeVisible();
  await expect(card(page, "Unread review").getByRole("button", { name: "Needs attention", exact: true })).toBeVisible();
  await page.reload(); await expect(card(page, "Unread review").getByRole("button", { name: "1 new updates for Unread review" })).toBeVisible();
  await card(page, "Unread review").getByRole("button", { name: "1 new updates for Unread review" }).click();
  await page.getByRole("dialog", { name: "Updates · Unread review" }).getByRole("button", { name: /^Open context:/ }).click();
  await expect(page.getByRole("dialog", { name: "Project context", exact: true })).toContainText("Concurrent update not shown in that receipt");
  expect((await api("POST", `${libraryRoot}/summary`, { projectIds: [project.id] }))[0].unread).toBe(1);
  expect(itemEvidence(item.id)).toEqual(before);
});

test("S5 [boundary] New excludes attention work; Mark all read leaves later arrivals unread and Activity owns other actions", async ({ page }) => {
  const p = libraryProject({ name: "Atlas" }); const f = await boundaryLibrary(page, { projects: [p] });
  const base = Date.now() - 60_000; const rows = Array.from({ length: 52 }, (_, i) => ({ ...contextEvent(p.id, `Meaningful update ${i}`), at: base + i })); f.events.set(p.id, rows);
  f.summaryPatches.set(p.id, { state: "attention", attention: { total: 1, decision: 1, review: 1, conflict: 1 }, archiveEligible: false });
  f.attention.set(p.id, [{ workItemId: "exact-work", title: "Review and conflict on one item", revision: 7, currentRunKey: "newest-run", categories: ["decision", "review", "conflict"] }]);
  await f.goto(); await card(page, p.name).getByRole("button", { name: /new updates for/ }).click();
  const dialog = page.getByRole("dialog", { name: "Updates · Atlas" });
  await expect(dialog.getByRole("region", { name: "Work needing attention" })).toHaveCount(0);
  await expect(dialog.getByText("Review and conflict on one item", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Mark all read" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Load older updates" }).click(); await expect(dialog).toContainText("Meaningful update 0");
  expect(f.calls.filter(c => c.pathname.endsWith("/events")).at(-1).search).toContain("cursor=50");
  const late = contextEvent(p.id, "Concurrent arrival"); f.events.get(p.id).push(late);
  await dialog.getByRole("button", { name: "Mark all read" }).click();
  await expect(dialog.getByRole("button", { name: "Mark read: Concurrent arrival" })).toBeVisible(); await expect(dialog.getByRole("status")).toContainText("1 unread");
  expect(f.calls.find(c => c.pathname.endsWith("/acknowledge-all")).body).toEqual({ asOf: rows[51].at, projectIds: [p.id] });
  expect(f.calls.some(c => c.pathname.endsWith("/acknowledge"))).toBe(false);
  expect(f.events.get(p.id).filter(e => e.unread).map(e => e.id)).toEqual([late.id]);
  await dialog.getByRole("button", { name: "Open Activity", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${p.id}`));
  await expect(page).not.toHaveURL(/workItem=/); expectNoExecution(f);
});

test("S5 [boundary] Library-wide Mark all read confirms, clears every project through one watermark and keeps work state untouched", async ({ page }) => {
  const a = libraryProject({ name: "Atlas" }); const b = libraryProject({ name: "Borealis" }); const f = await boundaryLibrary(page, { projects: [a, b] });
  f.events.set(a.id, [contextEvent(a.id, "Atlas changed"), contextEvent(a.id, "Atlas changed again")]); f.events.set(b.id, [contextEvent(b.id, "Borealis changed")]);
  await f.goto();
  const bar = page.getByRole("region", { name: "Unread updates" }); await expect(bar).toContainText("3 unread updates across 2 projects");
  await bar.getByRole("button", { name: "Mark all read" }).click();
  const confirm = page.getByRole("dialog", { name: "Mark all updates read?" }); await expect(confirm).toContainText("Decisions, reviews and conflicts are not resolved");
  await confirm.getByRole("button", { name: "Cancel" }).click(); expect(f.calls.some(c => c.pathname.endsWith("/acknowledge-all"))).toBe(false);
  await bar.getByRole("button", { name: "Mark all read" }).click();
  await page.getByRole("dialog", { name: "Mark all updates read?" }).getByRole("button", { name: "Mark 3 read" }).click();
  await expect(page.getByText("Marked 3 updates read. Work and files are unchanged.")).toBeVisible(); await expect(bar).toHaveCount(0);
  expect(f.calls.find(c => c.pathname.endsWith("/acknowledge-all")).body).toEqual({ asOf: expect.any(Number) });
  expect([...f.events.values()].flat().filter(e => e.unread)).toEqual([]); expectNoExecution(f);
});

test("S5 [boundary] clicking anywhere on a card opens the project while management actions stay separate", async ({ page }) => {
  const p = libraryProject({ name: "Atlas" }); const f = await boundaryLibrary(page, { projects: [p] }); await f.goto();
  const target = card(page, p.name);
  await target.getByRole("button", { name: `Open ${p.name}`, exact: true }).click(); await expect(page).toHaveURL(new RegExp(`project=${p.id}`));
  await expect(page.getByRole("dialog", { name: `Updates · ${p.name}` })).toHaveCount(0);
  await f.goto();
  const bounds = await target.boundingBox();
  await page.mouse.click(bounds.x + 8, bounds.y + bounds.height - 8); await expect(page).toHaveURL(new RegExp(`project=${p.id}`));
});

test("S6 [REAL DB-seeded history] archive/restore preserves UUID, source, Canvas/context/history/tags/grouping, not Focus", async ({ page }) => {
  const { project, api, source } = await registerReal(page, "Archive history"); fs.writeFileSync(path.join(source, "keep.txt"), "Never remove this file");
  await page.goto("/?view=desktop"); const item = await realWorkItem(page, project, "Retained historical work");
  changeRealItem(item.id, { runtime_state: "inactive", outcome: "completed", resolution: "reviewed" });
  const group = await api("POST", `${libraryRoot}/collections`, { name: "Archive retention" });
  let library = await api("GET", libraryRoot); let record = library.projects.find(p => p.id === project.id);
  await api("PATCH", `${libraryRoot}/projects/${project.id}`, { expectedRevision: record.revision, tags: ["retained"], collectionIds: [group.id] });
  library = await api("GET", libraryRoot); await api("PUT", `${libraryRoot}/focus`, { expectedRevision: library.focusRevision, projectIds: [project.id] });
  await api("PUT", `/api/projects/${project.id}/context`, { content: "Retained project context" });
  await api("PUT", `/api/projects/${project.id}/state`, { nodes: [{ id: "archive-note", type: "markdown", position: { x: 12, y: 34 }, size: { width: 280, height: 240 }, data: { title: "Retained Canvas history", content: "Archive is organization only", viewMode: "preview" } }], transform: { x: 32, y: 44, scale: .8 } });
  const workspace = await api("GET", `/api/projects/${project.id}`); const before = itemEvidence(item.id); const eventsBefore = await api("GET", `${libraryRoot}/projects/${project.id}/events`);
  await refreshLibrary(page); let dialog = await openDetails(page, "Archive history"); await dialog.getByRole("button", { name: "Archive project", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Archive Archive history?", exact: true }); await expect(dialog).toContainText("work history");
  await dialog.getByRole("button", { name: "Confirm archive" }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Archived", exact: true }).click();
  dialog = await openDetails(page, "Archive history"); await dialog.getByRole("button", { name: "Restore to Library" }).click(); await expect(dialog).toContainText("not Focus");
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Library", exact: true }).click();
  await page.reload(); await expect(card(page, "Archive history")).toBeVisible();
  record = (await api("GET", libraryRoot)).projects.find(p => p.id === project.id);
  expect(record).toMatchObject({ id: project.id, path: source, archived: false, focusOrder: null, tags: ["retained"], collectionIds: [group.id] });
  const restoredWorkspace = await api("GET", `/api/projects/${project.id}`); expect(restoredWorkspace.nodes).toEqual(workspace.nodes); expect(restoredWorkspace.context).toBe(workspace.context); expect(restoredWorkspace.transform).toEqual(workspace.transform);
  expect(itemEvidence(item.id)).toEqual(before); expect((await api("GET", `${libraryRoot}/projects/${project.id}/events`)).events).toEqual(eventsBefore.events);
  assertSource(source, "Never remove this file"); expect(runCount(project.id)).toBe(0);
});

test("S6 [REAL DB-seeded race] stale quiet eligibility cannot archive newly running/pending/unknown work", async ({ page }) => {
  const { project, api } = await registerReal(page, "Archive race"); await page.goto("/?view=desktop");
  const item = await realWorkItem(page, project, "Race item"); changeRealItem(item.id, { runtime_state: "inactive", outcome: "completed", resolution: "reviewed" });
  const quiet = (await api("POST", `${libraryRoot}/summary`, { projectIds: [project.id] }))[0]; expect(quiet.archiveEligible).toBe(true);
  const revision = (await api("GET", libraryRoot)).projects.find(p => p.id === project.id).revision;
  for (const patch of [
    { runtime_state: "working", outcome: "none", resolution: "open" },
    { runtime_state: "inactive", outcome: "completed", resolution: "open" },
    { runtime_state: "unrecognized-runtime", outcome: "none", resolution: "open" },
  ]) {
    changeRealItem(item.id, patch); const before = itemEvidence(item.id);
    const result = await api("POST", `${libraryRoot}/projects/${project.id}/archive`, { expectedRevision: revision }, 409);
    expect(result.code).toBe("ARCHIVE_UNSAFE"); expect(itemEvidence(item.id)).toEqual(before);
    expect((await api("GET", libraryRoot)).projects.find(p => p.id === project.id)).toMatchObject({ archived: false, revision });
  }
});

for (const unsafe of ["running", "pending", "unknown", "race"]) test(`S6 [boundary] ${unsafe} archive stays safe and recoverable without stop/delete`, async ({ page }) => {
  const p = libraryProject({ name: "Atlas" }); const f = await boundaryLibrary(page, { projects: [p] });
  const patch = unsafe === "running" ? { state: "running", activeLeaders: 1, archiveEligible: false }
    : unsafe === "pending" ? { state: "attention", attention: { total: 1, decision: 0, review: 1, conflict: 0 }, archiveEligible: false }
    : { freshness: "unknown", state: "unknown", attention: null, unread: null, archiveEligible: false };
  if (unsafe !== "race") f.summaryPatches.set(p.id, patch);
  await f.goto(); const d = await openDetails(page, p.name); await d.getByRole("button", { name: "Archive project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Archive Atlas?" });
  if (unsafe === "race") {
    await expect(dialog.getByRole("button", { name: "Confirm archive" })).toBeEnabled(); f.summaryPatches.set(p.id, patch);
    await dialog.getByRole("button", { name: "Confirm archive" }).click(); await expect(dialog.getByRole("alert")).toContainText("archive blocked");
  } else { await expect(dialog.getByRole("button", { name: "Confirm archive" })).toBeDisabled(); }
  expect(f.library.projects[0].archived).toBe(false); expectNoExecution(f);
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(card(page, p.name)).toBeVisible();
});

test("S8 [boundary] loading, offline retained records, unknown and summary retry never imply Up to date", async ({ page }) => {
  await page.clock.install();
  const p = libraryProject({ name: "Atlas" }); const f = await boundaryLibrary(page, { projects: [p] }); const release = f.hold(`GET ${libraryRoot}`);
  await f.goto(); await expect(page.getByRole("status").filter({ hasText: "Loading Library" })).toBeVisible(); release(); await expect(card(page, p.name)).toBeVisible();
  f.failures.set(`GET ${libraryRoot}`, "Injected offline Library"); await refreshLibrary(page);
  await expect(page.getByRole("alert")).toContainText("Existing records are retained"); await expect(card(page, p.name)).toBeVisible();
  f.failures.delete(`GET ${libraryRoot}`); await page.getByRole("button", { name: "Retry Library" }).click(); await expect(page.getByRole("alert")).toHaveCount(0);
  f.summaryPatches.set(p.id, { freshness: "unknown", state: "unknown", unread: null, attention: null, archiveEligible: false }); await refreshLibrary(page);
  // Explicit status retry through a controlled failed response, not a sleep for polling.
  f.failures.set(`POST ${libraryRoot}/summary`, "Injected summary outage");
  await page.clock.fastForward(6000); await expect(page.getByRole("button", { name: "Retry status", exact: true })).toBeVisible();
  f.failures.delete(`POST ${libraryRoot}/summary`); await page.getByRole("button", { name: "Retry status", exact: true }).click();
  await expect(card(page, p.name).locator(".pl-state, .pl-card-agents, footer")).toHaveCount(0);
  await expect(card(page, p.name).getByRole("button", { name: "Open Atlas", exact: true })).toBeVisible();
});

test("S8 [boundary clock/visibility] many projects use visible-ID bounded batches, no per-card data streams; hidden refresh deduplicates", async ({ page }) => {
  await page.clock.install(); const projects = Array.from({ length: 61 }, (_, i) => libraryProject({ name: `Batch ${String(i).padStart(2, "0")}` }));
  const f = await boundaryLibrary(page, { projects }); await f.goto(); await expect(page.getByRole("article")).toHaveCount(24);
  await expect.poll(() => f.calls.filter(c => c.pathname === `${libraryRoot}/summary`).length).toBe(1);
  const firstIds = f.calls.find(c => c.pathname === `${libraryRoot}/summary`).body.projectIds;
  expect(firstIds).toHaveLength(24); expect(new Set(firstIds).size).toBe(24);
  // Browser boundary simulation of visibility, explicitly not a real background-tab measurement.
  await page.evaluate(() => { window.__libraryHidden = true; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.__libraryHidden ? "hidden" : "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.fastForward(30000); expect(f.calls.filter(c => c.pathname === `${libraryRoot}/summary`)).toHaveLength(1);
  const release = f.hold(`POST ${libraryRoot}/summary`);
  await page.evaluate(() => { window.__libraryHidden = false; for (let i = 0; i < 5; i++) { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); } });
  await expect.poll(() => f.calls.filter(c => c.pathname === `${libraryRoot}/summary`).length).toBe(2); release();
  await expect(card(page, projects.find(p => p.id === firstIds[0]).name).locator(".pl-state, footer")).toHaveCount(0);
  await page.getByRole("button", { name: "Next projects" }).click(); await expect(page.getByRole("article")).toHaveCount(24);
  await expect.poll(() => f.calls.filter(c => c.pathname === `${libraryRoot}/summary`).length).toBe(3);
  const batch2 = f.calls.filter(c => c.pathname === `${libraryRoot}/summary`)[2].body.projectIds; expect(batch2.some(id => firstIds.includes(id))).toBe(false);
  for (const c of f.calls.filter(c => c.pathname === `${libraryRoot}/summary`)) { expect(c.body.projectIds.length).toBeLessThanOrEqual(100); expect(new Set(c.body.projectIds).size).toBe(c.body.projectIds.length); }
  expect(f.calls.filter(c => /\/(events|attention|context|state|history|git-status)$/.test(c.pathname))).toEqual([]);
  expect(f.commands.filter(c => /sync_session|get_work_item|get_task_graph/.test(c.type))).toEqual([]); expectNoExecution(f);
});

for (const width of [1440, 390]) test(`S3 [boundary] failed organization remains recoverable through panel and Library refresh at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const p = libraryProject({ name: "Recovery transitions" }); const f = await boundaryLibrary(page, { projects: [p] }); await f.goto();
  let dialog = await openDetails(page, p.name);
  f.failures.set(`PUT ${libraryRoot}/focus`, { error: "Injected Focus failure" });
  f.failures.set(`GET ${libraryRoot}`, { error: "Injected Library failure" });
  await dialog.getByRole("button", { name: "Add to desk", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Refresh before retrying" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); dialog = await openDetails(page, p.name);
  await expect(dialog.getByRole("button", { name: "Add to desk", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Refresh before retrying" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  f.failures.delete(`GET ${libraryRoot}`); f.failures.delete(`PUT ${libraryRoot}/focus`);
  await refreshLibrary(page);
  await expect(page.getByText(/Latest Library could not be loaded/)).toHaveCount(0);
  dialog = await openDetails(page, p.name); await expect(dialog.getByRole("button", { name: "Add to desk", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Add to desk", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Remove from desk", exact: true })).toBeVisible(); expectNoExecution(f);
});

test("S3 [boundary] collection edit scope requires discard instead of silently replacing staged input", async ({ page }) => {
  const f = await boundaryLibrary(page, { collections: [{ id: "existing", name: "Saved collection" }] }); await f.goto();
  await page.getByLabel("Library tools", { exact: true }).click();
  await page.getByRole("button", { name: "Manage collections" }).click(); const dialog = page.getByRole("dialog", { name: "Collections", exact: true });
  await dialog.getByRole("textbox", { name: "New collection name", exact: true }).fill("Unsaved new collection");
  await dialog.getByRole("button", { name: "Rename Saved collection" }).click();
  await expect(dialog.getByRole("textbox", { name: "New collection name", exact: true })).toHaveValue("Unsaved new collection");
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await dialog.getByRole("button", { name: "Rename Saved collection" }).click(); await dialog.getByRole("button", { name: "Discard and switch" }).click();
  await expect(dialog.getByRole("textbox", { name: "Collection name", exact: true })).toHaveValue("Saved collection");
  expect(f.calls.filter(c => ["POST", "PATCH", "DELETE"].includes(c.method) && c.pathname.includes("/collections"))).toEqual([]); expectNoExecution(f);
});

test("S4 [REAL] project context draft survives Canvas/Activity and guards Library departure", async ({ page }) => {
  const { project, api } = await registerReal(page, "Draft Context"); await api("PUT", `/api/projects/${project.id}/context`, { content: "Saved instructions" });
  await page.goto(`/?view=desktop&project=${project.id}&surface=canvas`);
  await page.getByRole("button", { name: /^☰.*Draft Context/ }).click(); await page.getByRole("button", { name: "context", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace context" }).fill("Keep unsaved instructions");
  await page.getByRole("tab", { name: "Activity", exact: true }).click(); await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Workspace context" })).toHaveValue("Keep unsaved instructions");
  await page.locator(".project-header").getByRole("button", { name: "All projects", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "Keep your unsaved work" }); await expect(guard).toBeVisible(); await guard.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await returnToLibrary(page);
  expect((await api("GET", `/api/projects/${project.id}/context`)).content).toBe("Saved instructions"); expect(runCount(project.id)).toBe(0);
});

test.describe("mobile category draft continuity", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });
  test("S4 [boundary] All settings cannot discard a changed action recipe", async ({ page }) => {
    const p = libraryProject({ name: "Mobile draft" }); const f = await boundaryLibrary(page, { projects: [p] }); await f.goto("/m");
    await page.getByRole("button", { name: "Open Mobile draft", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /^Context actions/ }).click();
    const name = page.getByRole("textbox", { name: "Name", exact: true }); const original = await name.inputValue();
    await name.fill("Retain this mobile edit"); await page.getByRole("button", { name: "All settings", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Keep your unsaved work" }); await expect(guard).toBeVisible(); await guard.getByRole("button", { name: "Keep editing" }).click();
    await expect(name).toHaveValue("Retain this mobile edit");
    // Internal recipe replacement must not clear the owner and bypass category protection.
    const unselectedRecipe = page.locator('[role="option"][aria-selected="false"]').first();
    await expect(unselectedRecipe).toBeVisible(); await unselectedRecipe.click();
    await expect(name).toHaveValue("Retain this mobile edit");
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(name).toHaveValue(original); await page.getByRole("button", { name: "All settings", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Settings categories" })).toBeVisible(); expectNoExecution(f);
    await page.getByRole("button", { name: /^Context actions/ }).click();
    await name.fill("Saved default recipe"); await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".mob-settings-save")).toHaveText("Saved");
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "All settings", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
    expect(f.calls.filter(c => c.key === `PUT /api/projects/${p.id}/settings`)).toHaveLength(1); expectNoExecution(f);
  });
});

test("S4 [boundary] desktop Settings retains recipe drafts across category and dismissal", async ({ page }) => {
  const p = libraryProject({ name: "Desktop recipe" }); const f = await boundaryLibrary(page, { projects: [p] }); await f.goto();
  await card(page, "Desktop recipe").getByRole("button", { name: "Open Desktop recipe", exact: true }).click();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: /^Context actions/ }).click();
  const name = page.getByRole("textbox", { name: "Name", exact: true }); const original = await name.inputValue();
  await name.fill("Keep desktop recipe");
  for (const route of ["category", "escape", "trigger"]) {
    if (route === "category") await page.getByRole("button", { name: /^Workspace/ }).click();
    else if (route === "escape") await name.press("Escape");
    else await page.getByRole("button", { name: "Open settings", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Keep your unsaved work" }); await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Keep editing" }).click(); await expect(name).toHaveValue("Keep desktop recipe");
  }
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(name).toHaveValue(original);
  await name.press("Escape"); await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toHaveCount(0);
  expect(f.calls.filter(c => c.key === `PUT /api/projects/${p.id}/settings`)).toEqual([]); expectNoExecution(f);
});
