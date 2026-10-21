import { expect, test } from "@playwright/test";
import { boundaryLibrary, libraryProject, card, details, openDetails, longName, longPath, contextEvent, expectNoExecution, libraryRoot } from "./project-library-fixture.mjs";
import { tabTo, noHorizontalOverflow, assertPaint, assertControlGeometry, assertFocusRing } from "./project-library-geometry.mjs";

const widths = [1440, 820, 390, 320];
const skins = ["midnight", "daybook", "deep-current", "alpine", "proof-sheet", "studio-warm", "cathode", "lavender-field", "blueprint", "ink", "obsidian", "porcelain"];
async function populated(page, theme) {
  await page.addInitScript(theme => localStorage.setItem("canvas-theme", theme), theme);
  const group = { id: "long-collection", name: "Collection".repeat(18) };
  const tag = "Tag".repeat(60);
  const normal = libraryProject({ name: "Quiet project", path: "/workspace/quiet", tags: [tag], collectionIds: [group.id] });
  const long = libraryProject({ name: longName, path: longPath, tags: [tag], collectionIds: [group.id] });
  const attention = libraryProject({ name: "Review project" });
  const running = libraryProject({ name: "Running project" });
  const failed = libraryProject({ name: "Failed project" });
  const unknown = libraryProject({ name: "Unknown project" });
  const f = await boundaryLibrary(page, { projects: [normal, long, attention, running, failed, unknown], collections: [group] });
  f.events.set(long.id, [contextEvent(long.id, "Headline".repeat(60))]);
  f.summaryPatches.set(attention.id, { state: "attention", attention: { total: 1, decision: 1, review: 1, conflict: 0 }, archiveEligible: false });
  f.summaryPatches.set(running.id, { state: "running", activeLeaders: 1, archiveEligible: false });
  f.events.set(failed.id, [{ ...contextEvent(failed.id, "Work failed; review the result"), kind: "work_item", workItemId: "failed-work", destination: { view: "activity", workItemId: "failed-work" } }]);
  f.leaderPreviews.set(failed.id, [{ workItemId: "failed-work", title: "Work failed; review the result", at: Date.now() }]);
  f.summaryPatches.set(failed.id, { state: "attention", attention: { total: 1, decision: 0, review: 1, conflict: 0 }, archiveEligible: false });
  f.summaryPatches.set(unknown.id, { freshness: "unknown", state: "unknown", unread: null, attention: null, archiveEligible: false });
  await f.goto(); await expect(card(page, normal.name)).toBeVisible(); await expect(card(page, "Running project").getByRole("button", { name: "Running", exact: true })).toBeVisible();
  return { f, group, tag, normal, long };
}

for (const theme of ["midnight", "daybook"]) for (const width of widths) test(`S7/S8 [boundary] compact hierarchy/reflow/labels/native controls at ${width}px in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
  const { f, group, tag, normal, long } = await populated(page, theme);
  await expect(card(page, "Review project").getByRole("button", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(card(page, "Running project").getByRole("button", { name: "Running", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Recent conversations for Failed project", exact: true })).toContainText("Work failed; review the result");
  await expect(card(page, "Unknown project").getByText("Status unavailable")).toBeVisible();
  await expect(card(page, normal.name).locator(".pl-unread")).toHaveCount(0);
  await expect(card(page, long.name).getByRole("button", { name: `1 new updates for ${long.name}`, exact: true })).toBeVisible();
  await expect(page.locator(".pl-index-row")).toHaveCount(6);
  const height = (await card(page, normal.name).boundingBox()).height;
  expect(height, "Compact index row rather than full-size card").toBeLessThanOrEqual(width > 720 ? 64 : 100);
  expect(height).toBeGreaterThanOrEqual(52);
  await expect(card(page, normal.name).locator(".pl-recent-row")).toHaveCount(0);
  await expect(card(page, normal.name).locator(".pl-state")).toHaveCount(0);
  await expect(card(page, normal.name).locator(".pl-card-description, .pl-status-rail, .pl-tags")).toHaveCount(0);
  const paints = await page.locator(".pl-index-row").evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
  expect(new Set(paints).size, "States use neutral shared surfaces, not colored panels").toBe(1);
  await noHorizontalOverflow(page);
  await page.getByLabel("Collection", { exact: true }).selectOption(group.id); await page.getByLabel("Tag", { exact: true }).selectOption(tag);
  await expect(page.locator(".pl-filter-chip > span")).toHaveText([group.name, tag]);
  for (const scale of [1, 2]) {
    await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, scale);
    // Prove text actually scaled; a zoomed screenshot alone would not prove 200% text.
    await expect(card(page, normal.name).locator(".pl-index-name")).toHaveCSS("font-size", `${13 * scale}px`);
    await noHorizontalOverflow(page);
    await assertControlGeometry(page.locator(".project-library button, .project-library input, .project-library select"), info, `library-${width}-${theme}-${scale}x`);
    await assertPaint(page.locator(".project-library"), info, `paint-${width}-${theme}-${scale}x`);
    const opener = details(page, long.name); await opener.scrollIntoViewIfNeeded(); await opener.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
    await expect(opener).toBeFocused(); await assertFocusRing(opener, info);
    await page.keyboard.press("Enter"); const dialog = page.getByRole("dialog", { name: `${long.name}`, exact: true });
    await expect(dialog).toBeVisible(); await expect(dialog.getByText(longPath, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await noHorizontalOverflow(page);
    await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("UnbrokenDescription".repeat(70));
    await dialog.getByRole("textbox", { name: "Add tag", exact: true }).fill(tag);
    const footer = dialog.getByRole("button", { name: "Save changes" }); await footer.scrollIntoViewIfNeeded(); await expect(footer).toBeInViewport();
    await assertControlGeometry(dialog.locator("button, input, textarea"), info, `details-${width}-${scale}x`);
    await assertPaint(dialog, info, `details-paint-${width}-${scale}x`);
    await dialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Escape"); await expect(dialog.getByRole("alert")).toContainText("Unsaved changes");
    await tabTo(page, dialog.getByRole("button", { name: "Discard and close" })); await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    await noHorizontalOverflow(page);
  }
  expectNoExecution(f);
});

for (const theme of skins) test(`S7 [boundary] retained skin ${theme} has readable Library, details and updates after transition`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); const { f, long } = await populated(page, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await assertPaint(page.locator(".project-library"), info, `${theme}-library`);
  const dialog = await openDetails(page, long.name); await assertPaint(dialog, info, `${theme}-details`);
  await dialog.getByRole("button", { name: "Updates", exact: true }).click();
  const updates = page.getByRole("dialog", { name: `Updates · ${long.name}`, exact: true });
  await expect(updates.getByRole("button", { name: "Mark all read" })).toBeEnabled();
  await expect(updates.getByRole("region", { name: "Recorded updates" })).toContainText("Headline".repeat(60));
  await noHorizontalOverflow(page); await assertPaint(updates, info, `${theme}-updates`);
  expectNoExecution(f);
});

for (const width of widths) test(`S7 [boundary] keyboard-only tab trap, disabled organization, Escape and focus return at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); const p = libraryProject({ name: "Keyboard project" }); const f = await boundaryLibrary(page, { projects: [p] }); await f.goto();
  const opener = details(page, p.name); await tabTo(page, opener); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Keyboard project" }); const close = dialog.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused(); await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("textbox", { name: "Display name", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Archive project", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(dialog.getByRole("textbox", { name: "Display name", exact: true })).toBeFocused();
  await tabTo(page, dialog.getByRole("textbox", { name: "Display name", exact: true })); await page.keyboard.type(" draft");
  await expect(dialog.getByRole("button", { name: "Open Canvas", exact: true })).toBeDisabled();
  const focusNames = [];
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); const focus = await page.evaluate(() => ({ inDialog: !!document.activeElement.closest('[role="dialog"]'), disabled: document.activeElement.matches(":disabled"), text: document.activeElement.textContent })); expect(focus.inDialog).toBe(true); expect(focus.disabled).toBe(false); focusNames.push(focus.text); }
  expect(focusNames).not.toContain("Add to desk");
  await page.keyboard.press("Escape"); await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeVisible();
  await tabTo(page, dialog.getByRole("button", { name: "Keep editing" })); await page.keyboard.press("Enter"); await expect(dialog.getByRole("button", { name: "Discard and close" })).toHaveCount(0);
  await page.keyboard.press("Escape"); await tabTo(page, dialog.getByRole("button", { name: "Discard and close" })); await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await page.keyboard.press("Enter"); await tabTo(page, page.getByRole("dialog").getByRole("button", { name: "Archive project", exact: true })); await page.keyboard.press("Enter");
  const archive = page.getByRole("dialog", { name: "Archive Keyboard project?" }); await expect(archive.getByRole("button", { name: "Confirm archive" })).toBeEnabled();
  await page.keyboard.press("Escape"); await expect(archive).toHaveCount(0);
  // The intermediate Details action disappeared; return must land on a live card
  // affordance, not body or a disconnected dialog element.
  await expect(opener).toBeFocused(); expectNoExecution(f);
});

for (const url of ["/?view=desktop", "/m"]) test(`S7 [boundary] organization parity and local navigation on ${url}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const p = libraryProject({ name: "Mobile parity" }); const f = await boundaryLibrary(page, { projects: [p] }); await f.goto(url);
  const d = await openDetails(page, p.name); await d.getByRole("button", { name: "Add to desk" }).click(); await expect(d.getByRole("button", { name: "Remove from desk" })).toBeVisible();
  await d.getByRole("button", { name: "Close", exact: true }).click(); await page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Focus desk", exact: true }).click();
  await expect(card(page, p.name)).toBeVisible(); await noHorizontalOverflow(page);
  await card(page, p.name).getByRole("button", { name: `Open ${p.name}`, exact: true }).click();
  if (url === "/m") { await expect(page.locator(".mob-activity")).toBeVisible(); await page.getByRole("button", { name: "Back to projects", exact: true }).click(); }
  else { await expect(page.getByRole("main", { name: "Activity workspace" })).toBeVisible(); await page.locator(".project-header").getByRole("button", { name: "All projects", exact: true }).click(); }
  await expect(page.getByRole("heading", { name: "Focus desk", exact: true })).toBeVisible(); await expect(card(page, p.name)).toBeVisible(); expectNoExecution(f);
});

for (const width of [1440, 320]) test(`S7/S8 [boundary clock] stale/error retry remains keyboard reachable at 200% text ${width}px`, async ({ page }, info) => {
  await page.clock.install(); await page.setViewportSize({ width, height: 844 }); const p = libraryProject({ name: "Retry project" }); const f = await boundaryLibrary(page, { projects: [p], summary: { [p.id]: { state: "running", activeLeaders: 1 } } }); await f.goto();
  await expect(card(page, p.name).getByRole("button", { name: "Running", exact: true })).toBeVisible();
  f.failures.set(`POST ${libraryRoot}/summary`, "Injected disconnected summary"); await page.clock.fastForward(16000);
  await expect(card(page, p.name).locator(".pl-state, .pl-card-agents, footer")).toHaveCount(0);
  await expect(page.getByText(/Status refresh unavailable/)).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
  const retry = page.getByRole("button", { name: "Retry status", exact: true }); await tabTo(page, retry); await expect(retry).toBeInViewport(); await assertFocusRing(retry, info); await noHorizontalOverflow(page);
  f.failures.delete(`POST ${libraryRoot}/summary`); await page.keyboard.press("Enter");
  await expect(card(page, p.name).getByRole("button", { name: "Running", exact: true })).toBeVisible(); expectNoExecution(f);
});
