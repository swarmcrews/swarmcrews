import { expect, test } from "@playwright/test";

const fixture = "/tests/e2e/button-polish-fixture.html";
async function expectSidePadding(button) {
  const padding = await button.evaluate(el => {
    const style = getComputedStyle(el);
    return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)];
  });
  for (const side of padding) expect(side).toBeGreaterThanOrEqual(8);
}

const colors = (locator) => locator.evaluate(el => {
  const style = getComputedStyle(el);
  return [style.backgroundColor, style.color, style.borderColor];
});

for (const theme of ["midnight", "daybook", "blueprint"]) {
  test(`button families preserve disabled states and theme geometry in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${fixture}?theme=${theme}`);
    const buttons = page.locator("[data-family] > button:not(:disabled)");
    await expect(buttons).toHaveCount(13);
    const radius = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--radius-control").trim());
    for (const button of await buttons.all()) {
      await expect(button).toHaveCSS("border-top-left-radius", radius);
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(32);
    }
    for (const button of await page.locator("[data-family] > button, .connections > button").all()) {
      await expectSidePadding(button);
    }
    for (const disabled of await page.locator("button:disabled").all()) {
      const before = await colors(disabled);
      await disabled.hover();
      expect(await colors(disabled)).toEqual(before);
    }
    await page.mouse.move(0, 0);
    await page.keyboard.press("Tab");
    const copy = page.getByRole("button", { name: "Copy to clipboard" });
    await expect(copy).toBeFocused();
    await expect(copy).toHaveCSS("opacity", "1");
    await expect(copy).toHaveCSS("outline-style", "solid");
    await page.getByRole("button", { name: "Open confirmation" }).click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test.describe("touch button geometry", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test("keeps copy/add discoverable and separated at phone widths", async ({ page }) => {
    await page.goto(fixture);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const button of await page.locator("[data-family] > button, .copy-btn").all()) {
        const box = await button.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      for (const button of await page.locator("[data-family] > button, .connections > button").all()) {
        await expectSidePadding(button);
      }
      const copy = page.getByRole("button", { name: "Copy to clipboard" });
      const add = page.getByRole("button", { name: "Add as node" });
      await expect(copy).toHaveCSS("opacity", "1");
      await expect(add).toHaveCSS("opacity", "1");
      const a = await add.boundingBox();
      const c = await copy.boundingBox();
      expect(a.x + a.width).toBeLessThan(c.x);
      const text = await page.getByTestId("copy-content").boundingBox();
      expect(text.y).toBeGreaterThanOrEqual(c.y + c.height);
      expect(await page.evaluate(() => document.querySelector("main").scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
});
