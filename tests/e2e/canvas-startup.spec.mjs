import { test, expect } from "@playwright/test";

const fixture = "/tests/e2e/canvas-startup-fixture.html";
test("large canvases hydrate only nearby presentation without restarting runtimes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture);
  const card = id => page.locator(`[data-canvas-node-id="${id}"]`);
  await expect(page.locator(".canvas-node-card")).toHaveCount(60);
  await expect(page.locator(".cm-editor")).toHaveCount(1);
  await expect(page.locator(".md-preview")).toHaveCount(1);
  await expect(page.locator(".dashboard-surface")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.canvasRuntimeCount())).toBe(60);
  await expect.poll(() => card(0).locator(".leader-message-feed").evaluate(el =>
    el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  const editor = card(0).locator(".cm-content");
  await editor.fill("Preserve this draft");
  await page.getByRole("button", { name: "Update data" }).click();
  await expect(card(1).locator("header")).toContainText("Updated while offscreen");
  await expect(card(1).locator(".cm-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Warm card 1" }).click();
  await expect(card(1).locator(".cm-editor")).toHaveCount(1);
  await expect(card(1)).not.toBeInViewport(); // Hydrates ahead of the canvas clip.
  await expect(page.locator(".cm-editor")).toHaveCount(2);
  await page.getByRole("button", { name: "Pan to card 1" }).click();
  await expect.poll(() => card(1).locator(".leader-message-feed").evaluate(el =>
    el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2);
  await page.getByRole("button", { name: "Pan to card 0" }).click();
  await expect(editor).toHaveText("Preserve this draft");
  await expect(card(59).locator(".cm-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "Open parked card" }).click();
  await expect(card(59).locator(".cm-editor")).toHaveCount(1);
  await expect(page.locator(".cm-editor")).toHaveCount(3);
  expect(await page.evaluate(() => window.canvasRuntimeCount())).toBe(60);
  expect(errors).toEqual([]);
});

test("records eager versus viewport-aware startup cost on the same content", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const results = {};
  for (const mode of ["eager", "viewport"]) {
    await page.goto(`${fixture}${mode === "eager" ? "?eager" : ""}`);
    await expect(page.locator(".cm-editor")).toHaveCount(mode === "eager" ? 60 : 1);
    results[mode] = await page.evaluate(() => ({
      ...window.canvasStartupMetrics,
      elements: document.querySelectorAll("*").length,
      editors: document.querySelectorAll(".cm-editor").length,
      runtimes: window.canvasRuntimeCount(),
    }));
  }
  // Structural budget, not a flaky wall-clock threshold on a busy CI worker.
  expect(results.viewport.elements).toBeLessThan(results.eager.elements / 5);
  expect(results.viewport.runtimes).toBe(results.eager.runtimes);
  await testInfo.attach("canvas-startup-cost", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
});
