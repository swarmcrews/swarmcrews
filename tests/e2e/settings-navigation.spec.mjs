import { expect, test } from "@playwright/test";
import { openDesignFinishFixture } from "./design-finish-fixture.mjs";

async function expectBadgeContained(badge) {
  await expect(badge).toHaveCount(1);
  await badge.evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "center" }));
  await expect(badge).toBeInViewport({ ratio: 1 });
  expect(await badge.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const parent = element.parentElement.getBoundingClientRect();
    return box.left >= parent.left - 1 && box.right <= parent.right + 1 &&
      box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1;
  })).toBe(true);
}

for (const theme of ["Midnight", "Daybook"]) {
  test(`settings category text stays contained and readable in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDesignFinishFixture(page);
    await page.getByRole("button", { name: "Open settings", exact: true }).click();
    if (theme === "Daybook") await page.getByRole("button", { name: /^Daybook/ }).click();
    const navigation = page.getByRole("navigation", { name: "Settings categories" });
    await expect(navigation.locator("button .settings-beta-badge")).toHaveCount(0);

    for (const fontSize of [16, 24, 32]) {
      await page.evaluate((size) => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      for (const width of [1440, 780, 701, 700, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => document.fonts.ready);
        for (const button of await navigation.getByRole("button").all()) {
          await button.focus(); // Also exercises the narrow screen's scrollable navigation.
          await expect(button).toBeInViewport({ ratio: 1 });
          const clipped = await button.evaluate((item) => {
            const problems = [];
            const itemBox = item.getBoundingClientRect();
            for (const element of item.querySelectorAll("strong, small")) {
              if (getComputedStyle(element).display === "none") continue;
              const box = element.getBoundingClientRect();
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              while (walker.nextNode()) {
                if (!walker.currentNode.textContent.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                for (const rect of range.getClientRects()) {
                  if (rect.left < box.left - 1 || rect.right > box.right + 1 ||
                      rect.top < box.top - 1 || rect.bottom > box.bottom + 1 ||
                      rect.left < itemBox.left || rect.right > itemBox.right) {
                    problems.push(walker.currentNode.textContent);
                  }
                }
              }
            }
            return problems;
          });
          expect(clipped, `${theme}, viewport ${width}, root font ${fontSize}`).toEqual([]);
        }
        await expectBadgeContained(navigation.locator(".settings-nav__group-label .settings-beta-badge"));
        for (const category of ["Context actions", "Governance"]) {
          await navigation.getByRole("button", { name: new RegExp(category) }).click();
          await expect(page.getByRole("heading", { name: category, exact: true })).toBeVisible();
          await expectBadgeContained(page.locator(".settings-heading__meta .settings-beta-badge"));
          await expect(page.locator(".settings-heading h2 .settings-beta-badge")).toHaveCount(0);
        }
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigation.getByRole("button", { name: /Context actions/ }).click();
    await page.screenshot({ path: testInfo.outputPath("settings-desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await navigation.getByRole("button", { name: /Context actions/ }).focus();
    await page.screenshot({ path: testInfo.outputPath("settings-compact.png") });
  });
}
