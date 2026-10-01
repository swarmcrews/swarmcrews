import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

test("return briefing refreshes recorded outcomes newest first without duplicating active work", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openResponsiveFixture(page);
  const briefing = page.getByRole("main", { name: "Activity return briefing" });
  await expect(briefing.getByRole("region", { name: "Needs your input" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Active: 3. Filter activity" })).toBeVisible();

  const sessions = Array.from({ length: 7 }, (_, index) => ({
    sessionKey: `history-${index}`, sessionId: null, role: "leader",
    projectId: "layout-review", cwd: "C:/sample/layout-review",
    status: index === 0 ? "error" : "completed",
    taskName: index === 0 ? "Old unresolved error" : `Completed task ${index}`,
    lastActivity: `Report for task ${index}`,
    lastActivityAt: Date.now() - (7 - index) * 60_000,
  }));
  fixture.send({ type: "session_list", sessions });
  // Incoming events do not silently rewrite the captured return briefing.
  await expect(briefing.getByRole("button", { name: /Source unavailable: Improve responsive/ })).toBeDisabled();
  await briefing.getByRole("button", { name: /Refresh briefing/ }).click();
  const outcomes = briefing.getByRole("region", { name: "What moved forward" });
  await expect(outcomes.getByRole("button")).toHaveCount(6);
  await expect(outcomes.locator("strong")).toHaveText([
    "Completed task 6", "Completed task 5", "Completed task 4", "Completed task 3",
    "Completed task 2", "Completed task 1",
  ]);
  await expect(briefing.getByRole("region", { name: "Worth picking back up" })
    .getByRole("button", { name: "Resume work: Old unresolved error" })).toBeVisible();

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const row of [outcomes.getByRole("button").first(), outcomes.getByRole("button").last()]) {
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport({ ratio: 1 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }

  fixture.send({ type: "session_list", sessions: [
    ...sessions, { ...sessions[0], sessionKey: "new-live", taskName: "New active task", status: "running" },
  ] });
  await expect(page.getByRole("button", { name: "Active: 1. Filter activity" })).toBeVisible();
  await expect(outcomes.getByRole("button")).toHaveCount(6);
  await expect(briefing).not.toContainText("New active task");
});

test("waiting tasks are attention requests rather than active work", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openResponsiveFixture(page);
  const briefing = page.getByRole("main", { name: "Activity return briefing" });
  await expect(briefing.getByRole("button", { name: "Review request: Improve responsive layouts across laptop screens" })).toBeVisible();

  const waiting = Array.from({ length: 3 }, (_, index) => ({
    sessionKey: `waiting-${index}`, sessionId: null, role: "leader",
    projectId: "layout-review", cwd: "C:/sample/layout-review", status: "waiting",
    taskName: `Paused task ${index}`, lastActivityAt: Date.now(),
  }));
  fixture.send({ type: "session_list", sessions: waiting });
  await expect(page.getByRole("button", { name: "Active: 0. Filter activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Needs attention: 3. Filter activity" })).toBeVisible();
  await briefing.getByRole("button", { name: /Refresh briefing/ }).click();
  await expect(briefing.getByRole("region", { name: "Needs your input" }).getByRole("button")).toHaveCount(3);

  fixture.send({ type: "session_list", sessions: [
    { ...waiting[0], status: "running" }, ...waiting.slice(1),
  ] });
  await expect(page.getByRole("button", { name: "Active: 1. Filter activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Needs attention: 2. Filter activity" })).toBeVisible();
  await briefing.getByRole("button", { name: /Refresh briefing/ }).click();
  await expect(briefing.getByRole("region", { name: "Needs your input" }).getByRole("button")).toHaveCount(2);
  await expect(briefing).not.toContainText("Paused task 0");
});
