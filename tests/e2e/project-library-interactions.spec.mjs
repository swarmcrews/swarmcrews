import { expect, test } from "@playwright/test";
import { boundaryLibrary, libraryProject, contextEvent, expectNoExecution } from "./project-library-fixture.mjs";
import { assertPaint, assertControlGeometry, noHorizontalOverflow } from "./project-library-geometry.mjs";

async function setup(page) {
  const project = libraryProject({ name: "Interaction finish" });
  const fixture = await boundaryLibrary(page, { projects: [project] });
  fixture.leaderPreviews.set(project.id, [{ workItemId: "leader", title: "Review focused changes", at: Date.now() }]);
  fixture.events.set(project.id, [contextEvent(project.id)]);
  await fixture.goto();
  const card = page.getByRole("article", { name: "Recent conversations for Interaction finish", exact: true });
  await expect(card).toBeVisible();
  await expect(card.locator(".pl-highlight-new")).toBeVisible();
  return { fixture, card, row: page.getByRole("article", { name: project.name, exact: true }) };
}

for (const theme of ["midnight", "daybook"]) for (const width of [1440, 390]) {
  test(`surface/action hover ownership in ${theme} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("canvas-theme", theme), theme);
    const { fixture, card, row } = await setup(page);
    const primary = card.locator(".pl-project-action"), leader = card.locator(".pl-highlight-session"), badge = card.locator(".pl-new-badge");
    const resting = await card.evaluate(el => ({ fill: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderColor }));
    await page.evaluate(() => document.fonts.ready);
    const geometry = await card.boundingBox();
    await card.hover({ position: { x: 5, y: 5 } });
    await expect(primary.locator("svg")).toHaveCSS("opacity", "1");
    await expect(primary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await leader.hover();
    await expect(primary.locator("svg")).toHaveCSS("opacity", "0");
    await expect(card).toHaveCSS("background-color", resting.fill);
    await expect(card).toHaveCSS("border-color", resting.border);
    await expect(leader).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(await card.boundingBox()).toEqual(geometry);
    await assertPaint(card, info, "leader-hover-paint");
    await card.locator(".pl-highlight-new").hover();
    await expect(card).toHaveCSS("background-color", resting.fill);
    await expect(badge).toBeVisible();
    await page.mouse.down();
    await assertPaint(card, info, "new-pressed-paint");
    await page.mouse.move(0, 0); await page.mouse.up(); // Release outside; don't open the dialog.
    const rowFill = await row.evaluate(el => getComputedStyle(el).backgroundColor);
    await row.locator(".pl-index-more").hover();
    await expect(row).toHaveCSS("background-color", rowFill);
    await expect(row.locator(".pl-index-name svg")).toHaveCSS("opacity", "0");

    await page.keyboard.press("Tab"); await primary.focus();
    await expect.poll(() => primary.evaluate(el => getComputedStyle(el, "::after").outlineWidth)).toBe("2px");
    await expect(card).toHaveCSS("outline-style", "none");
    await page.keyboard.press("Tab"); // The new action is next, independent of project navigation.
    await expect(card.locator(".pl-highlight-new")).toBeFocused();
    await expect(card.locator(".pl-highlight-new")).toHaveCSS("outline-width", "2px");
    await page.keyboard.press("Tab");
    await expect(leader).toBeFocused();
    await expect(leader).toHaveCSS("outline-width", "2px");
    await expect.poll(() => primary.evaluate(el => getComputedStyle(el, "::after").outlineStyle)).toBe("none");
    await expect(card).toHaveCSS("outline-style", "none");
    for (const scale of [1, 2]) {
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale * 16}px`; }, scale);
      await noHorizontalOverflow(page);
      await assertControlGeometry(page.locator(".pl-highlights button, .pl-project-index button"), info, `controls-${scale}x`);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(primary.locator("svg")).toHaveCSS("transition-duration", "0s");
    expectNoExecution(fixture);
  });
}

test.describe("touch feedback", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("does not apply desktop hover paint on a coarse pointer", async ({ page }) => {
    const { fixture, card } = await setup(page);
    expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(false);
    const fill = await card.evaluate(el => getComputedStyle(el).backgroundColor);
    await card.hover({ position: { x: 5, y: 5 } });
    await expect(card).toHaveCSS("background-color", fill);
    await expect(card.locator(".pl-project-action svg")).toHaveCSS("opacity", "0");
    expectNoExecution(fixture);
  });
});
