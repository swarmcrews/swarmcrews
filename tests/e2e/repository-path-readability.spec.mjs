import { test, expect } from "@playwright/test";

const directory = "/home/developer/PersonalRepositories";
const entries = Array.from({ length: 18 }, (_, i) => ({
  name: i === 0 ? "repository-with-a-very-long-unbroken-name-" + "x".repeat(50) : `project-${String(i).padStart(2, "0")}`,
  path: `${directory}/${i === 0 ? "repository-with-a-very-long-unbroken-name-" + "x".repeat(50) : `project-${String(i).padStart(2, "0")}`}`,
}));
const suggestions = {
  platform: "posix", separator: "/", roots: [{ name: "Home", path: "/home/developer" }],
  directory, parent: "/home/developer", breadcrumbs: [{ name: "Home", path: "/home/developer" }, { name: "PersonalRepositories", path: directory }],
  entries, truncated: false,
};

for (const theme of ["midnight", "daybook"]) {
  for (const view of ["desktop", "mobile"]) {
    test(`${view} repository suggestions are readable and keyboard selection stays visible in ${theme}`, async ({ page }, info) => {
      await page.addInitScript(id => localStorage.setItem("canvas-theme", id), theme);
      await page.route("**/api/projects/path-suggestions", route => route.fulfill({ json: suggestions }));
      await page.setViewportSize({ width: view === "desktop" ? 1280 : 390, height: 900 });
      await page.goto(`/?view=${view}`);
      await page.getByRole("button", { name: view === "desktop" ? "Register repository" : "Add repository", exact: true }).click();
      const input = page.getByRole("combobox", { name: "Folders on the server" });
      await input.fill(directory);
      const list = page.getByRole("listbox", { name: "Folders", exact: true });
      const panel = page.getByRole("region", { name: "Server folder suggestions" });
      await expect(list.getByRole("option")).toHaveCount(entries.length);
      await panel.screenshot({ path: info.outputPath("initial-panel.png") });
      const pathText = list.getByRole("option").first().locator("small");
      expect(await pathText.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
      await expect(pathText).not.toHaveCSS("white-space", "nowrap");
      const pathContrast = await pathText.evaluate(el => {
        const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        const layers = [];
        for (let node = el; node; node = node.parentElement) layers.unshift(getComputedStyle(node).backgroundColor);
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1, 1);
        for (const color of layers) { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); }
        const bg = ctx.getImageData(0, 0, 1, 1).data.slice(0, 3);
        ctx.fillStyle = getComputedStyle(el).color; ctx.fillRect(0, 0, 1, 1);
        const fg = ctx.getImageData(0, 0, 1, 1).data.slice(0, 3);
        const luminance = rgb => Array.from(rgb, (v, i) => {
          const s = v / 255; return (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
        }).reduce((a, b) => a + b);
        const a = luminance(bg), b = luminance(fg);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      expect(pathContrast).toBeGreaterThanOrEqual(4.5);
      if (view === "desktop") {
        const pickerBox = await page.locator(".repository-path-picker").boundingBox();
        const fieldsBox = await page.locator(".project-list-fields").boundingBox();
        expect(pickerBox.width).toBeCloseTo(fieldsBox.width, 0);
      }
      // Moving beyond the initially visible rows must scroll the active option, not the page.
      await input.focus();
      for (let i = 0; i < 17; i++) await input.press("ArrowDown");
      const active = list.getByRole("option", { selected: true });
      await expect(active).toContainText(entries[17].path);
      await expect.poll(async () => active.evaluate(el => {
        const row = el.getBoundingClientRect(), list = el.parentElement.getBoundingClientRect();
        return row.top >= list.top && row.bottom <= list.bottom + 1;
      })).toBe(true);
      await input.press("Enter");
      await expect(input).toHaveValue(entries[17].path);
      await expect(panel).toHaveCount(0);
      await expect(input).toBeFocused();
      // Closed input has a wrapping disclosure of its full selected path.
      await expect(page.locator(".repository-path-picker__value")).toHaveText(entries[17].path);
      for (const [width, fontSize] of [[view === "desktop" ? 1280 : 390, 16], [620, 16], [320, 16], [320, 32]]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
        await page.getByRole("button", { name: "Browse", exact: true }).click();
        await expect(list.getByRole("option")).toHaveCount(entries.length);
        await panel.scrollIntoViewIfNeeded();
        const panelBox = await panel.boundingBox();
        await page.keyboard.press("Tab");
        // Even with enlarged text, the close/recovery actions cannot be clipped
        // by the panel's overflow boundary.
        for (const control of ["Browse locations", "Close folder picker", "Use this folder", "Up one folder"]) {
          const button = panel.getByRole("button", { name: control, exact: true });
          const box = await button.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
          expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
          await button.focus();
          await expect(button).toHaveCSS("outline-style", "solid");
          expect(await button.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
        }
        // An oversized long-path row starts at its name, not halfway down.
        expect(await list.getByRole("option").first().evaluate(el => {
          const row = el.getBoundingClientRect(), list = el.parentElement.getBoundingClientRect();
          return row.top >= list.top - 1;
        })).toBe(true);
        const fullPath = list.getByRole("option").first().locator("small");
        expect(await fullPath.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        expect(await fullPath.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13 * fontSize / 16);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: info.outputPath(`picker-${width}-${fontSize}.png`), fullPage: true });
        await page.getByRole("button", { name: "Close folder picker" }).click();
        await expect(input).toBeFocused();
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
      await input.fill("/home/developer/PersonalRepositories/repository");
      await expect(list.getByRole("option")).toHaveCount(entries.length);
      await input.press("Enter");
      await expect(input).toHaveValue(entries[0].path);
      const disclosure = page.locator(".repository-path-picker__value");
      await expect(disclosure).toHaveText(entries[0].path);
      expect(await disclosure.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
  }
}
