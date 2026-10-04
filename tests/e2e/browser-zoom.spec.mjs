import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDesignFinishFixture } from "./design-finish-fixture.mjs";

test("native Chromium 200% tab zoom preserves launch reading, scrolling and keyboard access", async ({ baseURL }, testInfo) => {
  // Use Chromium's actual tab zoom, not CSS zoom, CDP pinch emulation or a
  // larger default font masquerading as browser zoom. This extension is test-only.
  const extension = testInfo.outputPath("zoom-extension");
  fs.mkdirSync(extension, { recursive: true });
  fs.writeFileSync(path.join(extension, "manifest.json"), JSON.stringify({
    manifest_version: 3, name: "Isolated browser zoom verification", version: "1.0",
    permissions: ["tabs"], background: { service_worker: "background.js" },
  }));
  fs.writeFileSync(path.join(extension, "background.js"), "chrome.runtime.onInstalled.addListener(() => {});");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "swarmcrews-browser-zoom-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true, baseURL, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const page = context.pages()[0] ?? await context.newPage();
    await openDesignFinishFixture(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    const zoom = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(tab => tab.url.startsWith(url));
      await chrome.tabs.setZoom(tab.id, 2);
      return chrome.tabs.getZoom(tab.id);
    }, baseURL);
    expect(zoom).toBe(2);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(800);
    const prompt = page.getByRole("textbox", { name: "Leader prompt" });
    await prompt.fill("Retain my draft while enlarging the workspace.");
    await prompt.focus();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({ tag: document.activeElement.tagName, width: document.activeElement.getBoundingClientRect().width }));
    expect(focused.tag).not.toBe("BODY");
    expect(focused.width).toBeGreaterThan(0);
    await expect(prompt).toHaveValue("Retain my draft while enlarging the workspace.");
    const launch = page.getByRole("button", { name: "Launch leader", exact: true });
    await launch.scrollIntoViewIfNeeded();
    await expect(launch).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("native-zoom-200.png"), animations: "disabled" });
    await testInfo.attach("native 200% browser zoom", { path: testInfo.outputPath("native-zoom-200.png"), contentType: "image/png" });
    const permission = page.getByRole("combobox", { name: "Permissions", exact: true });
    await permission.selectOption("bypassPermissions");
    const descriptionId = await permission.getAttribute("aria-describedby");
    const description = page.locator(`[id="${descriptionId}"]`);
    await description.evaluate(el => el.scrollIntoView({ block: "center" }));
    await expect(description).toContainText("Skip permission checks");
    await expect(description).toBeInViewport({ ratio: 1 });
    await expect(launch).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath("native-zoom-safety-200.png"), animations: "disabled" });
    await testInfo.attach("native zoom selected safety meaning", { path: testInfo.outputPath("native-zoom-safety-200.png"), contentType: "image/png" });
    await testInfo.attach("native zoom metrics", { body: JSON.stringify({ nativeZoom: zoom, ...await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio })) }), contentType: "application/json" });
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
