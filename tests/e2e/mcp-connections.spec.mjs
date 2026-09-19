import path from "node:path";
import { test, expect } from "@playwright/test";
import { openProjectFixture } from "./project-fixture.mjs";

for (const view of ["desktop", "mobile"]) {
  test(`${view} adds, tests, inspects, disables and removes a real local MCP connection`, async ({ page }) => {
    await page.setViewportSize(view === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await openProjectFixture(page, `MCP journey ${view}`);
    if (view === "mobile") await page.getByRole("button", { name: "Settings", exact: true }).click();
    else {
      await page.getByRole("button", { name: "Open settings", exact: true }).click();
      await page.getByRole("button", { name: "Connections Apps and MCP tools" }).click();
    }
    const panel = page.getByRole("region", { name: "Connections", exact: true });
    await panel.getByRole("button", { name: "Add connection", exact: true }).click();
    await panel.getByLabel("Have an install command or configuration?").fill(JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [path.resolve("tests/fixtures/mcp/server.mjs"), "path with spaces", ""] } } }));
    await panel.getByRole("button", { name: "Import configuration" }).click();
    await expect(panel.getByLabel("Argument 2", { exact: true })).toHaveValue("path with spaces");
    await expect(panel.getByLabel("Argument 3", { exact: true })).toHaveValue("");
    await panel.getByRole("button", { name: "Save & test connection" }).click();
    const card = panel.getByRole("article", { name: "fixture", exact: true });
    await expect(card.getByText("Verified", { exact: true })).toBeVisible();
    await card.getByText("Explore capabilities · 1 tools", { exact: true }).click();
    await expect(card.getByText("echo", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(card.getByText("Disabled", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Test connection" })).toBeDisabled();
    await card.getByText("More", { exact: true }).click();
    await card.getByRole("button", { name: "Remove", exact: true }).click();
    await card.getByRole("button", { name: "Remove connection", exact: true }).click();
    await expect(panel.getByText("Bring your tools into the conversation")).toBeVisible();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("selects connection context from the header and launch chips and reviews approvals", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await openProjectFixture(page, "MCP context selection");
  const headerChip = page.getByRole("button", { name: "Connections", exact: true });
  expect(await headerChip.evaluate(element => element.closest("[data-dock-bar]") === null)).toBe(true);
  await headerChip.click();
  const panel = page.locator('[data-dock-panel="mcp"]');
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Add connection", exact: true }).click();
  await panel.getByLabel("Have an install command or configuration?").fill(JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [path.resolve("tests/fixtures/mcp/server.mjs")] } } }));
  await panel.getByRole("button", { name: "Import configuration" }).click();
  await panel.getByRole("checkbox", { name: "Self-serve", exact: true }).uncheck();
  await panel.getByRole("button", { name: "Save & test connection" }).click();
  await expect(panel.getByText(/Review Execution sandbox/)).toBeVisible();
  await headerChip.click();
  const launch = page.getByRole("region", { name: "Add an agent" });
  await launch.getByRole("button", { name: "Configure connections", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Select MCP connections" });
  await expect(picker.getByText("Select to allow use")).toBeVisible();
  await picker.getByRole("checkbox", { name: /fixture/ }).check();
  await expect(picker.getByText("Added to context")).toBeVisible();
  await expect(picker.getByText("Review MCP approvals")).toBeVisible();
  await page.screenshot({ path: "test-results/mcp-context-picker.png" });
  await picker.getByRole("button", { name: "Close connections" }).click();
  await expect(launch.getByRole("button", { name: "Configure connections, 1 selected" })).toBeVisible();
  await page.evaluate(() => {
    const original = WebSocket.prototype.send;
    window.__mcpLaunchCommands = [];
    WebSocket.prototype.send = function(data) {
      try { window.__mcpLaunchCommands.push(JSON.parse(String(data))); } catch { /* Protocol frame. */ }
      return original.call(this, data);
    };
  });
  await launch.getByLabel("Leader prompt", { exact: true }).fill("Use the selected fixture for this task.");
  await launch.getByRole("button", { name: "Launch leader" }).click();
  await expect.poll(() => page.evaluate(() => window.__mcpLaunchCommands.some(command => command.type === "continue_work_item" && command.connectionIds?.includes("fixture")))).toBe(true);
  expect(errors).toEqual([]);
});
