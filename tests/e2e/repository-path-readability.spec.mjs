import { test, expect } from "@playwright/test";

const home = "/home/developer";
const directory = home + "/PersonalRepositories";
const longName = "repository-with-a-very-long-unbroken-name-" + "x".repeat(50);
const entries = Array.from({ length: 18 }, (_, i) => ({
  name: i === 0 ? longName : `project-${String(i).padStart(2, "0")}`,
  path: directory + "/" + (i === 0 ? longName : `project-${String(i).padStart(2, "0")}`),
}));
const base = { platform: "posix", separator: "/", roots: [{ name: "developer", path: home }], truncated: false };

for (const theme of ["midnight", "daybook"]) for (const view of ["desktop", "mobile"]) {
  test(`${view} folder browser stays readable and keyboard controlled in ${theme}`, async ({ page }, info) => {
    await page.addInitScript(id => localStorage.setItem("canvas-theme", id), theme);
    await page.route("**/api/projects/path-suggestions", route => {
      const { path: current } = route.request().postDataJSON();
      const json = current === "~" || current === home
        ? { ...base, directory: home, parent: null, breadcrumbs: [{ name: "developer", path: home }], entries: [{ name: "PersonalRepositories", path: directory }] }
        : current === directory
          ? { ...base, directory, parent: home, breadcrumbs: [{ name: "developer", path: home }, { name: "PersonalRepositories", path: directory }], entries }
          : { ...base, directory: current, parent: directory, breadcrumbs: [{ name: "developer", path: home }, { name: "PersonalRepositories", path: directory }, { name: current.split("/").at(-1), path: current }], entries: [] };
      return route.fulfill({ json });
    });
    await page.setViewportSize({ width: view === "desktop" ? 1280 : 390, height: 900 });
    await page.goto(`/?view=${view}`);
    if (view === "mobile") await page.getByRole("button", { name: "Add repository", exact: true }).click();
    const choose = page.getByRole("button", { name: "Choose folder", exact: true });
    await expect(choose.or(page.getByRole("combobox", { name: "Search folders" }))).toBeVisible();
    if (await choose.isVisible()) await choose.click();
    await page.getByRole("option", { name: "PersonalRepositories", exact: true }).click();
    const search = page.getByRole("combobox", { name: "Search folders" });
    const list = page.getByRole("listbox", { name: "Folders", exact: true });
    const panel = page.getByRole("region", { name: "Choose a project folder" });
    await expect(list.getByRole("option")).toHaveCount(entries.length);
    await panel.screenshot({ path: info.outputPath("initial-panel.png") });
    const name = list.getByRole("option").first().locator("span");
    expect(await name.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
    await expect(name).not.toHaveCSS("white-space", "nowrap");
    const contrast = await name.evaluate(el => {
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
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await search.focus();
    for (let i = 0; i < 17; i++) await search.press("ArrowDown");
    const active = list.getByRole("option", { selected: true });
    await expect(active).toHaveText(entries[17].name);
    await expect.poll(async () => active.evaluate(el => {
      const row = el.getBoundingClientRect(), list = el.parentElement.getBoundingClientRect();
      return row.top >= list.top && row.bottom <= list.bottom + 1;
    })).toBe(true);
    await search.press("Enter");
    await expect(page.locator(".repository-path-picker__directory-path")).toHaveText(entries[17].path);
    await page.getByRole("button", { name: "Use folder " + entries[17].name }).click();
    await expect(page.locator(".repository-path-picker__value")).toHaveText(entries[17].path);
    for (const [width, fontSize] of [[view === "desktop" ? 1280 : 390, 16], [620, 16], [320, 16], [320, 32]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      await page.getByRole("button", { name: "Change folder" }).click();
      await page.getByRole("button", { name: "Up one folder" }).click();
      await expect(list.getByRole("option")).toHaveCount(entries.length);
      await expect(panel.locator(".repository-path-picker__breadcrumb-bar").getByRole("button", { name: "Use folder PersonalRepositories", exact: true })).toBeVisible();
      await search.focus();
      await search.press("Tab");
      for (const control of ["Home", "Locations", "Up one folder", "Cancel", "Use folder PersonalRepositories"]) {
        const button = panel.getByRole("button", { name: control, exact: true });
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await button.focus();
        await expect(button).toHaveCSS("outline-style", "solid");
      }
      const text = list.getByRole("option").first().locator("span");
      expect(await text.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await panel.screenshot({ path: info.outputPath(`browser-${width}-${fontSize}.png`) });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("button", { name: "Change folder" })).toBeFocused();
    }
  });
}
