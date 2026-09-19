import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

for (const view of ["desktop", "mobile"]) {
  test(`${view} browses server folders without opening a project`, async ({ page }) => {
    const home = process.env.MINIONS_E2E_HOME;
    if (!home) throw new Error("MINIONS_E2E_HOME is required");
    const parent = fs.mkdtempSync(path.join(home, "picker-"));
    const child = path.join(parent, "Résumé project");
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(parent, "private-file.txt"), "must not appear");
    const mutations = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/projects(?:\/open|\/git-status)?$/.test(new URL(request.url()).pathname)) {
        mutations.push(request.url());
      }
    });
    await page.setViewportSize(view === "mobile" ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto(`/?view=${view}`);
    if (view === "mobile") await page.getByRole("button", { name: "New project", exact: true }).click();
    const input = page.getByRole("combobox", { name: "Folders on the server" });
    await input.fill(parent);
    await page.getByRole("button", { name: "Browse", exact: true }).click();
    await expect(page.getByRole("option").filter({ hasText: "Résumé project" })).toBeVisible();
    await expect(page.getByText("private-file.txt", { exact: true })).toHaveCount(0);
    await page.getByRole("option").filter({ hasText: "Résumé project" }).click();
    await page.getByRole("button", { name: "Use this folder", exact: true }).click();
    await expect(input).toHaveValue(child);
    expect(mutations).toEqual([]);
    expect(fs.readdirSync(child)).toEqual([]);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.evaluate(() => document.documentElement.clientWidth));
  });
}
