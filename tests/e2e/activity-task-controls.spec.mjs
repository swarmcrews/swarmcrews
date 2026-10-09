import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

const skills = [{ id: "release-checks", name: "Release checks", description: "Verify a release",
  category: "testing", icon: "", accentColor: "#888888", template: "{{target}}", isDefault: true,
  variables: [{ name: "target", label: "Release target", type: "text", required: true }] }];

test("required skill input and launch share the goal card at desktop and narrow sizes", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openResponsiveFixture(page, { skills });
  await page.getByRole("button", { name: "New", exact: true }).click();
  const panel = page.getByRole("region", { name: "New leader" });
  const target = panel.getByRole("textbox", { name: "Release target Required" });
  const launch = panel.getByRole("button", { name: "Launch leader" });
  await panel.getByLabel("Leader prompt", { exact: true }).fill("Prepare the release");
  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await expect(panel.locator(".leader-launch-advanced")).not.toHaveAttribute("open");
    await target.fill("");
    await expect(target).toBeInViewport();
    await expect(launch).toBeDisabled();
    await target.fill("v2");
    await expect(launch).toBeEnabled();
    await launch.scrollIntoViewIfNeeded();
    await expect(launch).toBeInViewport({ ratio: 1 });
    await expect(panel.locator(".leader-launch-work").getByRole("button", { name: "Launch leader" })).toBeVisible();
    const bounds = await launch.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`launch-${width}.png`) });
  }
});

test("Stop stays labeled in the session header with either compact pane open", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openResponsiveFixture(page);
  await page.getByRole("button", { name: "Review request: Improve responsive layouts across laptop screens", exact: true }).click();
  fixture.send({ type: "session_status", sessionKey: "layout-0", status: "running" });
  const stop = page.locator(".act-inspector-topbar").getByRole("button", { name: "Stop", exact: true });
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await expect(stop).toBeInViewport({ ratio: 1 });
    await expect(stop.locator("span")).toBeVisible();
    const context = page.getByRole("button", { name: /Context/ });
    if (width < 1000) {
      await context.click();
      await expect(stop).toBeInViewport({ ratio: 1 });
      await page.getByRole("button", { name: "Conversation", exact: true }).click();
    }
    await page.screenshot({ path: info.outputPath(`stop-${width}.png`) });
  }
});
