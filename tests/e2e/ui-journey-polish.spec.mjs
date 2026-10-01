import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

async function isolatedRoutes(page) {
  const project = { id: "polish", name: "A project with a deliberately long name for narrow screens",
    path: "/workspace/polish", hasSidecar: true, nodes: [], settings: {}, skills: [],
    transform: { x: 0, y: 0, scale: 1 }, lastOpened: new Date().toISOString() };
  const session = { sessionKey: "polish-chat", sessionId: null, role: "leader", status: "waiting",
    cwd: project.path, projectId: project.id, taskName: "Review the interface" };
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/auth/token") ? { token: "fixture" }
      : path === "/api/projects" ? [project] : path === "/api/readiness" ? { harnesses: [] }
      : path.includes("skills") ? [] : project });
  });
  await page.routeWebSocket("**/ws*", socket => socket.onMessage(raw => {
    const message = JSON.parse(raw);
    const send = value => socket.send(JSON.stringify({ topic: value.sessionKey ? `session:${value.sessionKey}` : "global", ...value }));
    if (message.type === "list_sessions") send({ type: "session_list", sessions: [session],
      topic: message.projectId ? `project:${message.projectId}` : "global",
      includeArchived: message.includeArchived === true });
    if (message.type === "list_harnesses") send({ type: "harness_list", harnesses: [] });
    if (message.type === "list_work_items") send({ type: "work_item_response", command: message.type,
      requestId: message.requestId, success: true, result: { projectId: project.id, items: [], nextCursor: null } });
    if (message.type === "sync_session") send({ type: "sync_response", sessionKey: session.sessionKey, found: true,
      status: "waiting", events: [{ type: "sdk_event", sessionKey: session.sessionKey,
        event: { kind: "text", role: "assistant", text: "Keep **useful feedback** within reach.\n\n```js\nconst message = 'A long code example that can be panned without copying the response';\n```" } }] });
  }));
  return project;
}

test("confirmation remains keyboard-safe and contained at desktop, phone and constrained sizes", async ({ page }, info) => {
  await isolatedRoutes(page);
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Remove", exact: true });
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [640, 360]]) {
    await page.setViewportSize({ width, height });
    await opener.click();
    const dialog = page.getByRole("dialog");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Remove project" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    const bounds = await dialog.boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(width - 32);
    await expect(confirm).toBeInViewport();
    expect(await page.locator("#root").evaluate(el => el.inert)).toBe(true);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`confirm-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.locator("#root").evaluate(el => el.inert)).toBe(false);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await opener.click();
  expect(await page.locator(".confirm-modal").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
});

test("desktop command picker leaves backward keyboard navigation and the draft intact", async ({ page }) => {
  await openResponsiveFixture(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  const input = page.getByLabel("Leader prompt", { exact: true });
  await input.fill("/");
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("Shift+Tab");
  await expect(input).toHaveValue("/");
  await expect(input).not.toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("mobile responses offer keyboard Copy, useful feedback and comfortable touch targets", async ({ page }, info) => {
  const project = await isolatedRoutes(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
    value: { writeText: async text => { window.copiedResponse = text; } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/m");
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  await page.getByRole("button", { name: /Review the interface/ }).click();
  const copy = page.getByRole("button", { name: "Copy response", exact: true });
  await expect(copy).toBeVisible();
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1);
  expect(await page.evaluate(() => window.copiedResponse)).toContain("**useful feedback**");
  expect((await copy.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(copy).toBeFocused();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(copy).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`mobile-copy-${width}.png`) });
  }
});
