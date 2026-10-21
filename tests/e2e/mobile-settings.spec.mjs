import { legacyLibraryRoutes } from "./project-library-fixture.mjs";
import { expect, test } from "@playwright/test";

test.use({ isMobile: true, hasTouch: true });

async function openSettings(page) {
  const project = { id: "settings-mobile", name: "Mobile settings workspace", path: "/workspace/settings-mobile", hasSidecar: true };
  let settings = { defaultLeaderModel: "claude-opus-4-8", defaultMinionModel: "claude-sonnet-5" };
  const writes = [];
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path.endsWith("/auth/token")) json = { token: "settings-test" };
    else if (path === "/api/projects") json = [project];
    else if (path.endsWith("/settings")) {
      if (route.request().method() === "PUT") { settings = route.request().postDataJSON(); writes.push(settings); }
      json = settings;
    } else if (path.endsWith("/mcp-servers")) json = { entries: [], statuses: {}, invalid: [] };
    else if (path === "/api/readiness") json = { harnesses: [] };
    else if (path.includes("skills")) json = [{ id: "mobile-project-skill", name: "Mobile project Skill", description: "Project-specific mobile guidance", category: "general", icon: "P", accentColor: "#123456", template: "Review this project", variables: [] }];
    return route.fulfill({ json });
  });
  await legacyLibraryRoutes(page, [project]);
  await page.routeWebSocket("**/ws*", socket => socket.onMessage(raw => {
    const message = JSON.parse(raw);
    const send = data => socket.send(JSON.stringify({ topic: "global", ...data }));
    if (message.type === "list_sessions") send({ type: "session_list", sessions: [], topic: message.projectId ? `project:${message.projectId}` : "global" });
    if (message.type === "list_work_items") send({ type: "work_item_response", command: message.type, requestId: message.requestId, success: true, result: { projectId: project.id, items: [], nextCursor: null } });
    if (message.type === "list_harnesses") send({ type: "harness_list", harnesses: [{ name: "claude", models: [{ id: "claude-opus-4-8", label: "Opus 4.8" }, { id: "claude-sonnet-5", label: "Sonnet 5" }], builtInTools: [], commands: [], agents: [], account: { provider: "anthropic" }, capabilities: { thinking: true, mutationInterception: "complete", promptCaching: true, mcp: true, permissionPrompts: true, resume: true, partialMessages: true, builtInFilesystem: true, sandboxEnforcement: { filesystem: [], approval: false } } }] });
  }));
  await page.goto("/m");
  await page.getByRole("button", { name: /Mobile settings workspace/ }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
  return writes;
}

async function expectNoOverflow(page) {
  const overflow = await page.locator(".mob-settings, .mob-settings-detail, .settings-card, .settings-preferences, .context-actions, .connection-form").evaluateAll(elements =>
    elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className));
  expect(overflow).toEqual([]);
}

for (const theme of ["Midnight", "Daybook"]) for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
  test(`mobile settings parity in ${theme} at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const writes = await openSettings(page);
    const open = async category => {
      await page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name: new RegExp(`^${category}`) }).click();
      await expect(page.getByRole("heading", { name: category, level: 1 })).toBeVisible();
    };
    const back = async () => { await page.getByRole("button", { name: "All settings", exact: true }).click(); };
    await open("General");
    const themeButton = page.getByRole("button", { name: new RegExp(`^${theme}`) });
    await themeButton.click();
    await expect(themeButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.toLowerCase());
    expect(await page.evaluate(() => localStorage.getItem("canvas-theme"))).toBe(theme.toLowerCase());
    await back();
    await page.screenshot({ path: info.outputPath("settings-index.png") });
    for (const fontSize of [16, 24]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      await expectNoOverflow(page);
      await open("General");
      await expect(page.getByRole("button", { name: /^Daybook/ })).toBeVisible();
      await expectNoOverflow(page); await back();
      await open("Agent defaults");
      await expect(page.getByRole("region", { name: "Leader defaults" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Minion defaults" })).toBeVisible();
      await page.getByRole("checkbox", { name: /Adaptive tier routing/ }).check();
      await expect(page.getByRole("tablist", { name: "Minion assignment tiers" })).toBeVisible();
      // Claude does not enforce the provider-neutral sandbox axes.
      await expect(page.getByText("Not enforced by this harness", { exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Sandbox file access", exact: true })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Sandbox approval policy", exact: true })).toHaveCount(0);
      await expectNoOverflow(page);
      await page.screenshot({ path: info.outputPath(`settings-agents-${fontSize}.png`) });
      await back();
      await open("Workspace");
      await page.getByRole("checkbox", { name: /Isolate new Leader work/ }).uncheck();
      await page.getByRole("checkbox", { name: /Tidy layout/ }).uncheck();
      await expectNoOverflow(page); await back();
      await open("Governance");
      await page.getByRole("radio", { name: /Enforced/ }).check();
      await expectNoOverflow(page); await back();
      await open("Context actions");
      await page.getByRole("button", { name: "Create action", exact: true }).click();
      await page.getByRole("textbox", { name: "Name", exact: true }).fill("Phone action");
      await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Review the mobile settings");
      await page.getByRole("button", { name: "Open skill picker" }).click();
      await page.getByRole("checkbox", { name: /Mobile project Skill/ }).check();
      await page.getByRole("button", { name: "Close skill picker" }).click();
      await expectNoOverflow(page);
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
      await expect.poll(() => writes.some(value => value.dashboardLeaderActions?.some(action => action.name === "Phone action" && action.skillIds?.includes("mobile-project-skill")))).toBe(true);
      await back();
      await open("Connections");
      await page.getByRole("button", { name: "Add connection", exact: true }).click();
      const fields = await page.locator(".connection-form :is(input:not([type='checkbox']):not([type='radio']), select, textarea)").evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.every(size => size >= 16)).toBe(true);
      await expectNoOverflow(page); await back();
    }
    expect(writes.at(-1)).toMatchObject({ defaultWorktreeIsolation: false, tidyLayout: false, systemModel: "enforced", adaptiveMinionModelRouting: true });
    await open("Server");
    await page.getByRole("button", { name: "Restart Server", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Restart Swarmcrews server" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Restart Server", exact: true })).toBeFocused();
  });
}
