import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

async function contrastOf(locator, property = "color") {
  return locator.evaluate((el, property) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const parse = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
    };
    const mix = (a, b) => [...a.slice(0, 3).map((channel, i) => channel * a[3] + b[i] * (1 - a[3])), 1];
    const lum = color => color.slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
      .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255, 1];
    for (const node of ancestors) background = mix(parse(getComputedStyle(node).backgroundColor), background);
    const foreground = mix(parse(getComputedStyle(el)[property]), background);
    return (Math.max(lum(foreground), lum(background)) + .05) / (Math.min(lum(foreground), lum(background)) + .05);
  }, property);
}

// Contract-shaped WS/HTTP fixture; no sessions, providers or real projects launch.
for (const theme of ["midnight", "daybook"]) {
  test(`complete safety meaning and operable help in ${theme}`, async ({ page }, info) => {
    await page.addInitScript(id => localStorage.setItem("canvas-theme", id), theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const fixture = await openResponsiveFixture(page);
    fixture.send({ type: "harness_list", harnesses: [{ name: "claude",
      models: [{ id: "claude-opus-4-8", label: "Opus" }], builtInTools: [], commands: [], agents: [],
      account: { provider: "anthropic" }, capabilities: { permissionPrompts: true, thinking: true,
        sandboxEnforcement: { filesystem: ["read-only", "workspace-write", "unrestricted"], approval: true } },
    }] });
    await page.getByRole("button", { name: "New", exact: true }).click();
    const panel = page.getByRole("region", { name: "New leader" });
    await panel.locator(".leader-launch-advanced > summary").click();
    const sandbox = panel.locator(".leader-sandbox-policy");
    const file = sandbox.getByRole("combobox", { name: "Sandbox file access" });
    const approval = sandbox.getByRole("combobox", { name: "Sandbox approval policy" });
    const permission = panel.getByRole("combobox", { name: "Permissions", exact: true });
    const orchestration = panel.getByRole("combobox", { name: "Orchestration", exact: true });
    const meaning = select => panel.locator(`[id="${select}"]`);
    const checkDisclosure = async (select, text) => {
      const id = await select.getAttribute("aria-describedby");
      const copy = meaning(id);
      await expect(copy).toContainText(text);
      await copy.evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await expect(copy).toBeInViewport({ ratio: 0.99 });
      expect(await contrastOf(copy)).toBeGreaterThanOrEqual(4.5);
      expect(await copy.evaluate(el => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
        return style.whiteSpace === "normal" && el.scrollWidth <= el.clientWidth + 1
          && box.left >= parent.left - 1 && box.right <= parent.right + 1
          && el.scrollHeight <= el.clientHeight + 1 && parseFloat(style.fontSize) >= 12;
      })).toBe(true);
    };
    for (const [width, size] of [[1440, 16], [1024, 16], [320, 16], [320, 32], [1440, 32]]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, size);
      for (const option of ["auto", "default", "acceptEdits", "plan", "bypassPermissions"]) {
        await permission.selectOption(option);
        await checkDisclosure(permission, await permission.locator("option:checked").textContent());
      }
      await permission.selectOption("auto");
      for (const option of ["plan", "auto"]) {
        await orchestration.selectOption(option);
        await checkDisclosure(orchestration, await orchestration.locator("option:checked").textContent());
      }
      await panel.locator(".leader-launch-config-grid").first().screenshot({ path: info.outputPath(`values-${width}-${size}.png`) });
      for (const [option, text] of [["unrestricted", "Minions keep their task sandbox"],
        ["unrestricted-with-minions", "Remove the process sandbox for the Leader and its Minions"]]) {
        await file.selectOption(option);
        await checkDisclosure(file, text);
      }
      await approval.selectOption("never");
      await checkDisclosure(approval, "rejects escalation instead of prompting");
      expect(await file.inputValue()).toBe("unrestricted-with-minions");
      await expect(sandbox.getByText("Effective policy is resolved when the session starts.")).toBeVisible();
      const help = sandbox.getByRole("button", { name: "About sandbox file access" });
      await help.focus();
      await page.keyboard.press("Enter");
      const region = sandbox.getByRole("region", { name: "About sandbox file access" });
      await expect(region).toContainText("Full Host removes that boundary");
      await region.evaluate(el => el.scrollIntoView({ block: "center" }));
      await region.screenshot({ path: info.outputPath(`help-${width}-${size}.png`) });
      await page.keyboard.press("Escape");
      await expect(region).toBeHidden();
      await expect(help).toBeFocused();
      expect(await contrastOf(help, "outlineColor")).toBeGreaterThanOrEqual(3);
      await page.screenshot({ path: info.outputPath(`focus-${width}-${size}.png`) });
      expect(await help.evaluate(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        const panel = el.closest(".leader-launch-config");
        const points = [[r.left - 3, r.top + r.height / 2], [r.right + 3, r.top + r.height / 2],
          [r.left + r.width / 2, r.top - 3], [r.left + r.width / 2, r.bottom + 3]];
        return s.outlineWidth === "2px" && s.outlineOffset === "2px" && r.left >= 4
          && r.right <= innerWidth - 4 && r.top >= 4 && r.bottom <= innerHeight - 4
          && points.every(([x, y]) => panel.contains(document.elementFromPoint(x, y)));
      })).toBe(true);
      // Pointer path is the same native button activation used by touch.
      await help.click();
      await region.getByRole("button", { name: "Close sandbox file access help" }).click();
      await expect(help).toBeFocused();
      if (size === 32) {
        for (const [index, axis] of ["files", "approval"].entries()) {
          const field = sandbox.locator(".leader-sandbox-axis").nth(index);
          await field.evaluate(el => el.scrollIntoView({ block: "center" }));
          await field.screenshot({ path: info.outputPath(`sandbox-${axis}-${width}-${size}.png`) });
        }
      } else {
        await sandbox.screenshot({ path: info.outputPath(`sandbox-${width}-${size}.png`) });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await sandbox.locator("small").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(size === 32 ? 24 : 12);
    }
    // Short enlarged viewport: long prose is read by scrolling, not squeezed
    // into one frame. Prove the selected scope and final prose line are reachable.
    await page.setViewportSize({ width: 320, height: 568 });
    for (const select of [permission, orchestration, file]) {
      const id = await select.getAttribute("aria-describedby");
      const copy = meaning(id), value = copy.locator("strong");
      await value.evaluate(el => el.scrollIntoView({ block: "center" }));
      await expect(value).toBeInViewport({ ratio: 0.99 });
    }
    const fileCopy = meaning(await file.getAttribute("aria-describedby"));
    await page.screenshot({ path: info.outputPath("short-320-32-scope.png") });
    await fileCopy.evaluate(el => el.scrollIntoView({ block: "end" }));
    expect(await fileCopy.evaluate(el => {
      const text = el.lastChild, range = document.createRange();
      range.setStart(text, Math.max(0, text.textContent.length - 8));
      range.setEnd(text, text.textContent.length);
      const r = range.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    })).toBe(true);
    await page.screenshot({ path: info.outputPath("short-320-32-prose-end.png") });
  });
}

test("sandbox help supports touch activation and outside dismissal", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const page = await context.newPage();
  await openResponsiveFixture(page);
  await page.getByRole("button", { name: "New", exact: true }).tap();
  await page.setViewportSize({ width: 320, height: 1000 });
  const panel = page.getByRole("region", { name: "New leader" });
  const help = panel.getByRole("button", { name: "About sandbox approval policy" });
  await help.tap();
  const region = panel.getByRole("region", { name: "About sandbox approval policy" });
  await expect(region).toBeVisible();
  await region.getByRole("button", { name: "Close sandbox approval policy help" }).tap();
  await expect(help).toBeFocused();
  await help.tap();
  await panel.getByText("Git change mode controls where edits land", { exact: false }).tap();
  await expect(region).toBeHidden();
  await context.close();
});
