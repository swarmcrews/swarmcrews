import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

test("hides the empty active row and shows all recent work newest first", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openResponsiveFixture(page);
  await expect(page.getByText("Loading workspace…", { exact: true })).toBeHidden();
  const active = page.getByRole("region", { name: "Active tasks" });
  await expect(active).toBeVisible();
  await expect(active.getByRole("article")).toHaveCount(3);

  const sessions = Array.from({ length: 7 }, (_, index) => ({
    sessionKey: `history-${index}`, sessionId: null, role: "leader",
    projectId: "layout-review", cwd: "C:/sample/layout-review",
    status: index === 0 ? "error" : "completed",
    taskName: index === 0 ? "Old unresolved error" : `Completed task ${index}`,
    lastActivity: `Report for task ${index}`,
    lastActivityAt: Date.now() - (7 - index) * 60_000,
  }));
  fixture.send({ type: "session_list", sessions });
  await expect(active).toHaveCount(0);
  await expect(page.getByText(/No active tasks/)).toHaveCount(0);
  const recent = page.getByRole("region", { name: "Recent work" });
  await expect(recent.getByRole("button")).toHaveCount(7);
  await expect(recent.locator("strong")).toHaveText([
    "Completed task 6", "Completed task 5", "Completed task 4", "Completed task 3",
    "Completed task 2", "Completed task 1", "Old unresolved error",
  ]);

  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(recent).toBeVisible();
    await expect(recent.getByRole("button").first()).toBeInViewport({ ratio: 1 });
    await recent.getByRole("button").last().scrollIntoViewIfNeeded();
    await expect(recent.getByRole("button").last()).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }

  // The row comes back as soon as a task starts, without duplicating it in history.
  fixture.send({ type: "session_list", sessions: [
    ...sessions, { ...sessions[0], sessionKey: "new-live", taskName: "New active task", status: "running" },
  ] });
  await expect(active).toBeVisible();
  await expect(active.getByRole("article")).toHaveCount(1);
  await expect(recent.getByRole("button")).toHaveCount(7);
});


test("waiting tasks never appear as actively running cards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openResponsiveFixture(page);
  const active = page.getByRole("region", { name: "Active tasks" });
  const recent = page.getByRole("region", { name: "Recent work" });
  await expect(active.getByRole("article")).toHaveCount(3);
  await expect(active.getByText("Waiting for you", { exact: true })).toHaveCount(0);
  await expect(recent.getByRole("button", { name: /Improve responsive layouts across laptop screens/ })).toBeVisible();

  const waiting = Array.from({ length: 3 }, (_, index) => ({
    sessionKey: `waiting-${index}`, sessionId: null, role: "leader",
    projectId: "layout-review", cwd: "C:/sample/layout-review", status: "waiting",
    taskName: `Paused task ${index}`, lastActivityAt: Date.now(),
  }));
  fixture.send({ type: "session_list", sessions: waiting });
  await expect(active).toHaveCount(0);
  await expect(recent.getByRole("button")).toHaveCount(3);

  fixture.send({ type: "session_list", sessions: [
    { ...waiting[0], status: "running" }, ...waiting.slice(1),
  ] });
  await expect(active.getByRole("article")).toHaveCount(1);
  await expect(active.getByRole("article", { name: "Paused task 0" })).toBeVisible();
  await expect(recent.getByRole("button")).toHaveCount(2);
});
