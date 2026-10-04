import { expect, test } from "@playwright/test";

// HTTP/WS boundary simulation only: never writes a repository or starts a provider.
async function fixture(page) {
  const project = { id: "recovery", name: "Recovery Project", path: "/sample/recovery", nodes: [], graph: { edges: [] }, transform: { x: 0, y: 0, scale: 1 }, settings: {}, skills: [], hasSidecar: true, lastOpened: new Date().toISOString() };
  const calls = [];
  const failures = new Map();
  const holds = new Map();
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const key = `${request.method()} ${path}`;
    calls.push({ key, body: request.postDataJSON() });
    if (holds.has(key)) await holds.get(key);
    if (failures.has(key)) return route.fulfill({ status: 503, json: { error: failures.get(key) } });
    let json = {};
    if (path === "/api/auth/token") json = { token: "recovery-test" };
    else if (path === "/api/projects" && request.method() === "GET") json = [project];
    else if (path === "/api/projects/activity-summary") json = [{ projectId: project.id, activeLeaders: 0, activeCrew: 0 }];
    else if (path === "/api/projects/git-status") json = { isRepository: true };
    else if (path === "/api/readiness") json = { schemaVersion: 1, ready: true, readyHarnesses: [], harnesses: [] };
    else if (path === "/api/projects/path-suggestions") json = { platform: "posix", separator: "/", roots: [], directory: null, parent: null, breadcrumbs: [], entries: [], truncated: false };
    else if (path === "/api/projects/recovery" || path === "/api/projects/open" || (path === "/api/projects" && request.method() === "POST")) json = project;
    else if (path.includes("skills")) json = [];
    else if (path.includes("context")) json = { content: "" };
    return route.fulfill({ json });
  });
  await page.routeWebSocket("**/ws*", socket => socket.onMessage(raw => {
    const message = JSON.parse(raw);
    if (message.type === "list_sessions") socket.send(JSON.stringify({ type: "session_list", topic: `project:${project.id}`, sessions: [], includeArchived: message.includeArchived === true }));
    if (message.type === "list_harnesses") socket.send(JSON.stringify({ type: "harness_list", topic: "global", harnesses: [] }));
    if (message.type === "list_work_items") socket.send(JSON.stringify({ type: "work_item_response", topic: "global", command: message.type, requestId: message.requestId, success: true, result: { projectId: project.id, items: [], nextCursor: null } }));
  }));
  await page.goto("/?view=desktop");
  await expect(page.getByRole("button", { name: "Open Recovery Project" })).toBeVisible();
  return { calls, failures, hold(key) { let release; holds.set(key, new Promise(resolve => { release = resolve; })); return () => { holds.delete(key); release(); }; } };
}

// U11: successful navigation is acknowledged by the loaded named workspace,
// not the removed success toast. Error/registration-failure/rename/remove receipts remain.
async function expectOpenedWorkspace(page) {
  await expect(page.locator(".project-header")).toBeVisible();
  await expect(page.locator(".project-header")).toContainText("Recovery Project");
  await expect(page.getByRole("main", { name: "Activity workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Couldn’t open workspace" })).toHaveCount(0);
  await expect(page.getByText("Loading workspace…")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^Project opened|^Project registered\. Workspace opened/ })).toHaveCount(0);
}

async function checkFeedbackContrast(page, info) {
  const ratios = await page.locator(".project-feedback").evaluateAll(elements => {
    const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    return elements.map(el => {
      const s = getComputedStyle(el);
      const buttons = [...el.querySelectorAll("button")];
      return { text: ratio(s.color, s.backgroundColor), buttons: buttons.map(button => { const bs = getComputedStyle(button); return ratio(bs.color, bs.backgroundColor); }), focus: ratio(getComputedStyle(buttons[0]).outlineColor, s.backgroundColor) };
    });
  });
  for (const sample of ratios) {
    expect(sample.text).toBeGreaterThanOrEqual(4.5);
    for (const ratio of sample.buttons) expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(sample.focus).toBeGreaterThanOrEqual(3);
  }
  await info.attach("sampled-feedback-contrast", { body: JSON.stringify(ratios), contentType: "application/json" });
}

for (const theme of ["midnight", "daybook"]) for (const width of [1440, 320]) {
  test(`failed workspace GET exits loading and retries at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.addInitScript(id => localStorage.setItem("canvas-theme", id), theme);
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    const f = await fixture(page);
    f.failures.set("GET /api/projects/recovery", "Workspace temporarily unavailable");
    await page.getByRole("button", { name: "Open Recovery Project" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Couldn’t open workspace" })).toBeVisible();
    await expect(page.getByText("Loading workspace…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await checkFeedbackContrast(page, info);
    await page.screenshot({ path: info.outputPath(`load-error-${width}.png`) });
    const ring = await page.getByRole("button", { name: "Retry" }).evaluate(el => { const s = getComputedStyle(el); return { width: s.outlineWidth, style: s.outlineStyle }; });
    expect(ring).toEqual({ width: "2px", style: "solid" });
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    await page.getByRole("button", { name: "Projects", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Retry" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Projects", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`load-error-${width}-text200.png`) });
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    const initialLoads = f.calls.filter(c => c.key === "GET /api/projects/recovery").length;
    f.failures.delete("GET /api/projects/recovery");
    await page.getByRole("button", { name: "Retry" }).click();
    await expectOpenedWorkspace(page);
    expect(f.calls.filter(c => c.key === "GET /api/projects/recovery")).toHaveLength(initialLoads + 1);
  });
}

test("workspace error can return to Projects", async ({ page }) => {
  const f = await fixture(page);
  f.failures.set("GET /api/projects/recovery", "Not found");
  await page.getByRole("button", { name: "Open Recovery Project" }).click();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
});

for (const mode of ["open", "register"]) for (const width of [1440, 320]) {
  test(`${mode} retains values on failure and guards pending retries at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const f = await fixture(page);
    const key = mode === "open" ? "POST /api/projects/open" : "POST /api/projects";
    if (mode === "register") await page.getByRole("button", { name: "Register repository" }).click();
    const input = page.getByRole("combobox", { name: "Folders on the server" });
    await input.fill("/sample/" + "long-repository-name".repeat(10));
    await input.press("Escape");
    if (mode === "register") await page.getByRole("textbox", { name: "Project name" }).fill("My repository");
    f.failures.set(key, "Server unavailable");
    await page.getByRole("button", { name: mode === "open" ? "Open" : "Create", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Server unavailable" })).toBeVisible();
    await expect(input).toHaveValue("/sample/" + "long-repository-name".repeat(10));
    if (mode === "register") await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("My repository");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`repository-${mode}-error-${width}.png`) });
    f.failures.delete(key);
    const release = f.hold(key);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("button", { name: /Opening|Registering/ })).toBeDisabled();
    await expect(input).toBeDisabled();
    release();
    await expectOpenedWorkspace(page);
    expect(f.calls.filter(c => c.key === key)).toHaveLength(2);
  });
}

for (const width of [1440, 320]) test(`failed removal retains project, needs explicit retry confirmation, and acknowledges success at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const f = await fixture(page);
  f.failures.set("DELETE /api/projects/recovery", "Removal unavailable");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Your project folder and files will remain on disk");
  await dialog.getByRole("button", { name: "Remove project" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Removal unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Recovery Project" })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`remove-error-${width}.png`) });
  f.failures.delete("DELETE /api/projects/recovery");
  await page.getByRole("button", { name: "Retry removal" }).click();
  await expect(dialog).toBeVisible();
  expect(f.calls.filter(c => c.key === "DELETE /api/projects/recovery")).toHaveLength(1);
  const release = f.hold("DELETE /api/projects/recovery");
  await dialog.getByRole("button", { name: "Remove project" }).click();
  await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("status").filter({ hasText: "Removed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Recovery Project" })).toHaveCount(0);
  expect(f.calls.filter(c => c.key === "DELETE /api/projects/recovery")).toHaveLength(2);
});

for (const width of [1440, 320]) test(`rename failure preserves draft and last saved title at ${width}px; Enter does not duplicate pending save`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const f = await fixture(page);
  await page.getByRole("button", { name: "Open Recovery Project" }).click();
  await expect(page.locator(".root-loading")).toHaveCount(0);
  await page.locator(".project-switcher__trigger").click();
  await page.getByRole("menuitem", { name: "Rename project" }).click();
  const input = page.getByRole("textbox", { name: "Project name" });
  await input.fill("Renamed" + "Repository".repeat(15));
  f.failures.set("PUT /api/projects/recovery", "Rename unavailable");
  await input.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Rename unavailable" })).toBeVisible();
  await expect(page).toHaveTitle("Recovery Project (Swarmcrews)");
  await expect(input).toHaveValue("Renamed" + "Repository".repeat(15));
  await expect(input).toBeFocused();
  await page.screenshot({ path: info.outputPath(`rename-error-${width}.png`) });
  f.failures.delete("PUT /api/projects/recovery");
  const release = f.hold("PUT /api/projects/recovery");
  await page.getByRole("button", { name: "Retry rename" }).click();
  await expect(input).toBeDisabled();
  release();
  await expect(page.getByRole("status").filter({ hasText: "Project renamed" })).toBeVisible();
  await expect(page).toHaveTitle(/RenamedRepository/);
  await page.screenshot({ path: info.outputPath(`rename-success-${width}.png`) });
  expect(f.calls.filter(c => c.key === "PUT /api/projects/recovery")).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".project-switcher__trigger")).toBeFocused();
});


test("acknowledges registration even when the subsequent workspace load fails", async ({ page }) => {
  const f = await fixture(page);
  f.failures.set("GET /api/projects/recovery", "Workspace temporarily unavailable");
  await page.getByRole("button", { name: "Register repository" }).click();
  const input = page.getByRole("combobox", { name: "Folders on the server" });
  await input.fill("/sample/recovery");
  await input.press("Escape");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Couldn’t open workspace" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Project registered.");
  f.failures.delete("GET /api/projects/recovery");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".project-switcher__trigger")).toBeVisible();
  await expect(page.locator(".project-switcher")).not.toContainText(/opened/i);
  expect(f.calls.filter(c => c.key === "POST /api/projects")).toHaveLength(1);
});
