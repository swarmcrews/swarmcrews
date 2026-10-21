import { expect, test } from "@playwright/test";
import { boundaryLibrary, libraryProject, card, contextEvent, expectNoExecution } from "./project-library-fixture.mjs";
import { noHorizontalOverflow, assertControlGeometry } from "./project-library-geometry.mjs";

// Geometry must run in an authorized browser runner; component tests cannot prove it.
for (const viewport of [{ width: 320, height: 667 }, { width: 390, height: 844 }, { width: 812, height: 375 }]) {
  test(`mobile Projects prioritizes content at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const fixture = await boundaryLibrary(page, {
      projects: [libraryProject({ name: "Alpha", tags: ["client"], focusOrder: 0 }), libraryProject({ name: "Beta" })],
    });
    await page.goto("/m");
    await expect(card(page, "Alpha")).toBeVisible();
    const toggle = page.getByRole("button", { name: "Filters and tools" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Collection", { exact: true })).toHaveCount(0);
    const firstCard = await page.locator(".pl-card").first().boundingBox();
    if (viewport.height >= 667) {
      expect(firstCard.y, "App chrome and collapsed controls occupy roughly the top quarter").toBeLessThanOrEqual(viewport.height / 4 + 8);
    }
    await noHorizontalOverflow(page);
    await toggle.click();
    await page.getByLabel("Tag", { exact: true }).selectOption("client");
    await expect(toggle).toContainText("(1)");
    await expect(card(page, "Beta")).toHaveCount(0);
    await toggle.click();
    await expect(page.getByLabel("Tag", { exact: true })).toHaveCount(0);
    await expect(card(page, "Alpha")).toBeVisible();
    await toggle.click();
    await page.getByRole("button", { name: "Clear search and filters" }).click();
    await toggle.click();
    await page.getByRole("searchbox", { name: "Search projects" }).fill("Beta");
    await expect(card(page, "Alpha")).toHaveCount(0);
    await expect(card(page, "Beta")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search projects" }).fill("");
    await page.getByLabel("Project view", { exact: true }).selectOption("focus");
    await expect(card(page, "Alpha")).toBeVisible();
    await expect(card(page, "Beta")).toHaveCount(0);
    // Larger text may exceed the quarter-height target; nothing is clipped to enforce it.
    await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; });
    await toggle.click();
    await page.getByRole("button", { name: "Manage collections" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Manage collections" })).toBeInViewport();
    await noHorizontalOverflow(page);
    expectNoExecution(fixture);
  });
}

for (const viewport of [{ width: 320, height: 667 }, { width: 390, height: 844 }, { width: 812, height: 375 }]) {
  test(`mobile Status first cards and read actions reflow at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const running = libraryProject({ name: "Running project" });
    const updated = libraryProject({ name: "Updated project" });
    const quiet = libraryProject({ name: "Quiet project" });
    const fixture = await boundaryLibrary(page, {
      projects: [running, updated, quiet],
      summary: { [running.id]: { state: "running", activeLeaders: 1, activeCrew: 2 } },
    });
    fixture.events.set(running.id, [contextEvent(running.id, "Working update")]);
    fixture.events.set(updated.id, [contextEvent(updated.id, "A longer project update that stays readable on a narrow phone")]);
    await page.goto("/m");
    await expect(card(page, running.name).getByRole("button", { name: "Running", exact: true })).toBeVisible();
    await expect(card(page, updated.name).getByRole("button", { name: "New updates", exact: true })).toBeVisible();
    await expect(card(page, quiet.name).locator(".pl-state, footer, .pl-recent-row")).toHaveCount(0);
    const toggle = page.getByRole("button", { name: "Filters and tools" });
    const bulk = page.getByRole("region", { name: "Unread updates" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(bulk.getByRole("button", { name: "Mark all read", exact: true })).toBeVisible();
    for (const layout of ["List", "Grid"]) {
      await toggle.click();
      await page.getByRole("group", { name: "Project layout" }).getByRole("button", { name: layout, exact: true }).click();
      await toggle.click();
      await expect(card(page, running.name)).toHaveCSS("display", "block");
      expect(await page.locator(".pl-region .pl-projects").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(1);
      for (const scale of [1, 2]) {
        await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, scale);
        await expect(card(page, running.name).locator(".pl-name")).toHaveCSS("font-size", `${20 * scale}px`);
        await expect(card(page, quiet.name).locator(".pl-name")).toHaveCSS("font-size", `${18 * scale}px`);
        await noHorizontalOverflow(page);
        await assertControlGeometry(page.locator(".project-library--compact .pl-card button, .project-library--compact > .pl-updates-bar button"), info, `mobile-cards-${viewport.width}-${layout}-${scale}x`);
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    }
    await card(page, updated.name).getByRole("button", { name: `1 new updates for ${updated.name}` }).click();
    const updates = page.getByRole("dialog", { name: `Updates · ${updated.name}` });
    await updates.getByRole("button", { name: "Mark all read", exact: true }).click();
    await updates.getByRole("button", { name: "Close", exact: true }).click();
    await expect(card(page, updated.name).locator(".pl-state, footer")).toHaveCount(0);
    await expect(card(page, running.name).getByRole("button", { name: "Running", exact: true })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expectNoExecution(fixture);
  });
}
