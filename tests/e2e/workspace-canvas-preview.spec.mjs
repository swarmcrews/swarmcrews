import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

const note = (id, title, x, y) => ({ id, type: "markdown", position: { x, y }, size: { width: 400, height: 240 }, data: { title, content: "Private context body", viewMode: "preview" } });
const nodes = [note("brief", "Release brief", 0, 0), note("checks", "Verification notes", 520, 160), note("hidden", "Other workspace", 1400, 0),
  { id: "release", type: "canvas-zone", position: { x: 0, y: 0 }, size: { width: 0, height: 0 }, data: { version: 1, name: "Release", leaderIds: [], nodeIds: ["brief", "checks"] } },
  { id: "__canvas-global-workspace__", type: "canvas-zone", position: { x: 0, y: 0 }, size: { width: 0, height: 0 }, data: { version: 1, name: "Global", leaderIds: [], activeWorkspaceId: "release" } }];

test("briefing previews only the current workspace and opens it with the keyboard", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openResponsiveFixture(page, { nodes, edges: [{ id: "context", sourceNodeId: "brief", sourcePortId: "context-out", targetNodeId: "checks", targetPortId: "context-in", protocol: "context" }] });
  const preview = page.getByRole("region", { name: "Workspace canvas Release" });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("img")).toHaveAccessibleName(/Release workspace layout, 2 nodes/);
  await expect(preview.locator(".workspace-preview__edges path")).toHaveCount(1);
  await expect(preview).not.toContainText("Other workspace");
  await expect(preview).not.toContainText("Private context body");
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(preview).toBeInViewport({ ratio: 1 });
    const previewBounds = await preview.boundingBox();
    const headingBounds = await page.getByRole("heading", { name: "Since your last visit" }).boundingBox();
    const windowBounds = await page.locator(".act-briefing-window").boundingBox();
    expect(previewBounds.y).toBeGreaterThan(headingBounds.y + headingBounds.height);
    expect(previewBounds.y + previewBounds.height).toBeLessThanOrEqual(windowBounds.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`briefing-preview-${width}.png`), animations: "disabled" });
  }
  // Exercise the isolated component at a phone-sized available width; the mobile app
  // has its own Activity surface and does not render the desktop return briefing.
  await preview.evaluate(element => { element.style.width = "280px"; });
  expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(preview.getByRole("button", { name: "Open canvas" })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("briefing-preview-narrow.png"), animations: "disabled" });
  await preview.getByRole("button", { name: "Open canvas" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Canvas", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-canvas-node-id="brief"]')).toBeVisible();
  await expect(page.locator('[data-canvas-node-id="hidden"]')).toBeHidden();
});

test("empty canvas remains usable without invented nodes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openResponsiveFixture(page);
  const preview = page.getByRole("region", { name: "Workspace canvas Global" });
  await expect(preview.getByText("No nodes in this workspace yet.")).toBeVisible();
  await expect(preview.getByRole("img")).toHaveCount(0);
  await preview.getByRole("button", { name: "Open canvas" }).click();
  await expect(page.getByRole("tab", { name: "Canvas", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("agent preview colors follow semantic status tokens at every size", async ({ page }, info) => {
  const states = [
    ["Release ready", "inactive", "completed", null, "Ready for review", "success"],
    ["Implementation", "working", "none", null, "Working", "running"],
    ["Choose rollout", "waiting", "none", "decision", "Decision needed", "warning"],
    ["Investigate failure", "inactive", "error", null, "Error", "error"],
  ];
  const agents = states.map(([taskName, runtimeState, outcome, waitKind], i) => ({
    id: `agent-${i}`, type: "leader", position: { x: (i % 2) * 500, y: Math.floor(i / 2) * 210 },
    size: { width: 440, height: 170 }, data: { taskName, status: "disconnected", sessionKey: null,
      workItemSnapshot: { id: `work-${i}`, projectId: "layout-review", projectPath: "C:/sample/layout-review",
        title: taskName, currentRunKey: null, waitKind, iteration: 1, createdAt: 1, updatedAt: 2, lastTransitionAt: 2,
        lifecycle: { runtimeState, outcome, resolution: "open", changeMode: "live", integrationState: "live_clean", lifecycleRevision: 1 } } },
  }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openResponsiveFixture(page, { nodes: agents });
  const preview = page.getByRole("region", { name: "Workspace canvas Global" });
  await expect(preview.getByRole("img")).toHaveAccessibleDescription(/Ready for review: 1.*Working: 1.*Decision needed: 1.*Error: 1/);
  for (const [, , , , label, token] of states) {
    const rect = preview.locator(`[data-status="${label}"] rect`);
    await expect(rect).toBeVisible();
    const colors = await rect.evaluate((element, statusToken) => {
      const probe = document.createElement("span");
      probe.style.color = `var(--status-${statusToken})`;
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).stroke, expected };
    }, token);
    expect(colors.actual).toBe(colors.expected);
  }
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(preview).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath(`status-preview-${width}.png`), animations: "disabled" });
  }
  await preview.evaluate(element => { element.style.width = "280px"; });
  expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("status-preview-narrow.png"), animations: "disabled" });
});
