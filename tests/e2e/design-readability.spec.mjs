import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

for (const theme of ["midnight", "daybook"]) {
  test(`sandbox disclosures and context counts remain readable in ${theme}`, async ({ page }, info) => {
    await page.addInitScript(id => localStorage.setItem("canvas-theme", id), theme);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResponsiveFixture(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    const panel = page.getByRole("region", { name: "New leader" });
    const sandbox = panel.locator(".leader-sandbox-policy");
    const disclosures = sandbox.locator("small");
    const count = panel.getByRole("button", { name: "Configure connections", exact: true }).locator("strong");
    await expect(disclosures).toHaveCount(2);

    for (const [width, height] of [[1440, 900], [1024, 768], [320, 568]]) {
      await page.setViewportSize({ width, height });
      const sizes = await disclosures.evaluateAll(elements => elements.map(el => parseFloat(getComputedStyle(el).fontSize)));
      expect(sizes.every(size => size >= 12)).toBe(true);
      expect(await count.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(11);
      // The tinted count must use a stronger foreground than incidental metadata.
      expect(await count.evaluate(el => getComputedStyle(el).color)).toBe(await page.locator("html").evaluate(el => getComputedStyle(el).color));
      await disclosures.last().evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await expect(disclosures.last()).toBeInViewport({ ratio: 1 });
      await expect(panel.getByRole("button", { name: "Launch leader", exact: true })).toBeInViewport({ ratio: 1 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const help = sandbox.getByLabel("About sandbox file access");
      await page.keyboard.press("Tab");
      await help.focus();
      await expect(help).toBeFocused();
      const outline = await help.evaluate(el => { const style = getComputedStyle(el); return { width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle }; });
      expect(outline).toEqual({ width: "2px", offset: "2px", style: "solid" });
      await page.screenshot({ animations: "disabled", path: info.outputPath(`readability-${width}.png`) });
    }

    // This batch's type roles respect the reader's enlarged default font.
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    expect(await disclosures.last().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
    await disclosures.last().evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest" }));
    await expect(disclosures.last()).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole("button", { name: "Launch leader", exact: true })).toBeInViewport({ ratio: 1 });
  });
}
