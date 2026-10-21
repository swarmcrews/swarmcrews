import { expect, test } from "@playwright/test";
import { boundaryLibrary, libraryProject, card, expectNoExecution } from "./project-library-fixture.mjs";
import { noHorizontalOverflow, assertControlGeometry, assertPaint } from "./project-library-geometry.mjs";

for (const theme of ["midnight", "daybook"]) for (const width of [1440, 820, 390, 320]) {
  test(`archive density and accessible contextual actions at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("canvas-theme", theme), theme);
    const projects = Array.from({ length: 25 }, (_, i) => libraryProject({ name: i === 24 ? "LongArchivedRepository".repeat(10) : `Archived ${String(i).padStart(2, "0")}`, archived: true, path: i === 24 ? `/workspace/${"unbroken-folder".repeat(30)}` : `/workspace/client-${i}/repository`, lastOpened: new Date(Date.UTC(2026, 0, 25 - i)).toISOString() }));
    const fixture = await boundaryLibrary(page, { projects });
    await fixture.goto();
    await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Archived", exact: true }).click();
    await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    const first = card(page, "Archived 00");
    await expect(first.getByRole("button", { name: "View details for Archived 00" })).toBeVisible();
    await expect(first.getByText("Archived", { exact: true })).toHaveCount(0);
    expect((await first.boundingBox()).height).toBeLessThanOrEqual(width > 820 ? 110 : 160);
    const more = first.locator(".pl-more");
    const restore = first.getByRole("button", { name: "Restore Archived 00 to Library" });
    await page.mouse.move(0, 0);
    await expect(more).toHaveCSS("opacity", "0");
    await expect(restore).toHaveCSS("opacity", "1");
    const resting = await first.boundingBox();
    await first.hover(); await expect(more).toHaveCSS("opacity", "1");
    expect(await first.boundingBox()).toEqual(resting);
    await page.mouse.move(0, 0); await more.focus();
    await expect(more).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Archived 00", exact: true });
    await expect(dialog).toBeVisible(); await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(more).toBeFocused();
    for (const scale of [1, 2]) {
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale * 16}px`; }, scale);
      await noHorizontalOverflow(page);
      await assertControlGeometry(page.locator(".pl-projects button, .pl-results-toolbar button, .pl-results-toolbar select"), info, `archive-controls-${width}-${scale}`);
      await assertPaint(page.locator(".project-library"), info, `archive-paint-${width}-${scale}`);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    await page.getByRole("navigation", { name: "Project pages (bottom)" }).getByRole("button", { name: "Next projects" }).click();
    await expect(page.getByRole("region", { name: "Archived project results" })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Project pages (top)" })).toContainText("25–25 of 25");
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.locator(".pl-projects")).toHaveClass(/pl-projects--grid/);
    await noHorizontalOverflow(page);
    expectNoExecution(fixture);
  });
}

test.describe("touch archive actions", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("never hides restore or organization behind hover on a touch device", async ({ page }) => {
    const project = libraryProject({ name: "Touch archive", archived: true });
    const fixture = await boundaryLibrary(page, { projects: [project] });
    await fixture.goto("/m");
    await page.getByRole("combobox", { name: "Project view" }).selectOption("archived");
    const row = card(page, project.name);
    await expect(row.locator(".pl-more")).toHaveCSS("opacity", "1");
    await expect(row.getByRole("button", { name: "Restore Touch archive to Library" })).toBeVisible();
    await row.locator(".pl-more").tap();
    await expect(page.getByRole("dialog", { name: project.name, exact: true })).toBeVisible();
    expectNoExecution(fixture);
  });
});

test("focus desk exposes attention and reveals arrangement actions without layout shift", async ({ page }) => {
  const project = libraryProject({ name: "Focused project", focusOrder: 0 });
  const fixture = await boundaryLibrary(page, { projects: [project], summary: { [project.id]: { state: "attention", running: false, attention: { total: 1, decision: 1, review: 0, conflict: 0 } } } });
  await fixture.goto();
  await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Focus desk", exact: true }).click();
  const row = card(page, project.name);
  await expect(row.getByRole("button", { name: "Needs attention" })).toContainText("1 decision");
  const group = page.getByRole("group", { name: "Focus desk actions for Focused project" });
  await page.mouse.move(0, 0);
  const bounds = await group.boundingBox();
  await expect(group.locator(".pl-desk-arrange")).toHaveCSS("opacity", "0");
  await group.getByRole("button", { name: "Remove Focused project from desk" }).focus();
  await expect(group.locator(".pl-desk-arrange")).toHaveCSS("opacity", "1");
  expect(await group.boundingBox()).toEqual(bounds);
  expectNoExecution(fixture);
});
