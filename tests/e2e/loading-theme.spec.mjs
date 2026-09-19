import { test, expect } from "@playwright/test";

for (const theme of [
  { id: "daybook", background: "rgb(238, 242, 248)", text: "rgb(23, 32, 51)" },
  { id: "midnight", background: "rgb(10, 14, 26)", text: "rgb(230, 236, 245)" },
]) {
  for (const phase of ["static", "react"]) {
    test(`${phase} loading page restores ${theme.id} before the app loads`, async ({ page }) => {
      await page.addInitScript((id) => localStorage.setItem("canvas-theme", id), theme.id);
      await page.route(phase === "static" ? "**/src/main.tsx" : "**/src/App.tsx", async (route) => {
        // Keep the module pending so React remains in Suspense in the second phase.
        await new Promise((resolve) => page.once("close", resolve));
        await route.abort().catch(() => {});
      });
      await page.goto("/?view=desktop", { waitUntil: "commit" });
      if (phase === "react") await expect(page.locator("#root > [role=status]")).toHaveCSS("background-color", theme.background);
      await expect(page.getByRole("status")).toHaveText("Loading workspace…");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme.id);
      await expect(page.locator("body")).toHaveCSS("background-color", theme.background);
      await expect(page.locator(".brand__crews")).toHaveCSS("background-color", theme.text);
    });
  }
}
