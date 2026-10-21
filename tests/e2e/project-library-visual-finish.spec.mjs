import { expect, test } from "@playwright/test";
import { boundaryLibrary, libraryProject, card, openDetails, expectNoExecution, contextEvent, refreshLibrary } from "./project-library-fixture.mjs";
import { noHorizontalOverflow, assertPaint, assertControlGeometry, assertFocusRing } from "./project-library-geometry.mjs";

// Requires an authorized browser runner. DOM/source tests do not verify this paint.
for (const theme of ["midnight", "daybook"]) for (const width of [1440, 820, 390, 320]) {
  test(`visual finish: index/dialog continuity at ${width}px in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem("canvas-theme", theme), theme);
    const fixture = await boundaryLibrary(page, { projects: [libraryProject({ name: "Quiet project" }), libraryProject({ name: "LongProjectName".repeat(12) })] });
    await fixture.goto();
    await expect(card(page, "Quiet project")).toBeVisible();
    const brand = await page.locator(".project-list-brand").boundingBox();
    expect(brand.width, "Brand should be chrome, not a page-sized banner").toBeLessThanOrEqual(220);
    await expect(page.locator(".pl-section-heading").getByText("2 projects in Library", { exact: true })).toHaveText("2 projects in Library");
    await expect(card(page, "Quiet project").locator(".pl-state, footer, .pl-recent-row")).toHaveCount(0);
    await noHorizontalOverflow(page);
    const nav = page.getByRole("navigation", { name: "Project views" });
    const library = nav.getByRole("button", { name: "Library", exact: true });
    await library.focus();
    await assertFocusRing(library, info);
    for (const scale of [1, 2]) {
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, scale);
      const row = card(page, "Quiet project");
      await expect(row.locator(".pl-index-name")).toHaveCSS("font-size", `${13 * scale}px`);
      const anchors = await row.evaluate(el => ({ display: getComputedStyle(el).display, identity: getComputedStyle(el.querySelector(".pl-index-identity")).gridColumnStart }));
      expect(anchors.display).toBe("grid");
      await noHorizontalOverflow(page);
      await assertControlGeometry(page.locator(".project-library button, .project-library input, .project-library select"), info, `finish-${width}-${scale}x`);
      await assertPaint(page.locator(".project-library"), info, `finish-paint-${width}-${scale}x`);
      const dialog = await openDetails(page, "Quiet project");
      await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Description to preserve");
      const commit = dialog.getByRole("button", { name: "Save changes", exact: true });
      await expect(commit).toHaveClass(/pl-action--primary/);
      await commit.scrollIntoViewIfNeeded(); await expect(commit).toBeInViewport();
      await assertPaint(dialog, info, `finish-dialog-${width}-${scale}x`);
      await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await noHorizontalOverflow(page);
    }
    expectNoExecution(fixture);
  });
}

for (const width of [1440, 820, 390, 320]) {
  test(`Add repository stays anchored through expansion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await boundaryLibrary(page, { projects: [libraryProject({ name: "Existing project" })] });
    await fixture.goto();
    await expect(card(page, "Existing project")).toBeVisible();
    const trigger = page.locator(".pl-heading").getByRole("button", { name: "Add repository" });
    await trigger.scrollIntoViewIfNeeded();
    const before = await trigger.boundingBox();
    const staysAnchored = async () => {
      await expect.poll(async () => {
        const current = await trigger.boundingBox();
        return Math.max(Math.abs(current.x - before.x), Math.abs(current.y - before.y));
      }).toBeLessThanOrEqual(1);
    };
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".pl-registration-panel").getByRole("heading", { name: "Open a repository" })).toBeVisible();
    await staysAnchored();
    await noHorizontalOverflow(page);
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await staysAnchored();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await staysAnchored();
    expectNoExecution(fixture);
  });
}

for (const width of [1440, 820]) {
  test(`heading actions stay together and search owns half the filter row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const project = libraryProject({ name: "Toolbar project" });
    const fixture = await boundaryLibrary(page, { projects: [project] });
    fixture.events.set(project.id, [contextEvent(project.id)]);
    await fixture.goto();
    const add = page.getByRole("button", { name: "Add repository" });
    const mark = page.getByRole("button", { name: "Mark all read", exact: true });
    await expect(mark).toBeVisible();
    const addBounds = await add.boundingBox();
    const markBounds = await mark.boundingBox();
    const titleBounds = await page.getByRole("heading", { name: "Project Library" }).boundingBox();
    const toolsBounds = await page.getByLabel("Library tools", { exact: true }).boundingBox();
    expect(Math.abs((addBounds.y + addBounds.height / 2) - (titleBounds.y + titleBounds.height / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(addBounds.y - toolsBounds.y)).toBeLessThanOrEqual(1);
    expect(markBounds.y).toBeGreaterThan(addBounds.y + addBounds.height);
    await expect(page.getByRole("navigation", { name: "Project views" }).getByRole("button", { name: "Manage collections" })).toHaveCount(0);
    const searchBounds = await page.getByLabel("Search projects", { exact: true }).boundingBox();
    const collectionBounds = await page.getByLabel("Collection", { exact: true }).boundingBox();
    expect(searchBounds.width).toBeGreaterThanOrEqual(collectionBounds.width * 1.8);
    await page.getByLabel("Search projects", { exact: true }).fill("Toolbar");
    const positions = await page.locator(".pl-filters input, .pl-filters select, .pl-filters button").evaluateAll(elements => elements.map(el => el.getBoundingClientRect().y));
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
    await noHorizontalOverflow(page);
    await add.click();
    expect(Math.abs((await add.boundingBox()).y - addBounds.y)).toBeLessThanOrEqual(1);
    // The draft expands below the stable heading; updates follow the expanded panel.
    expect((await mark.boundingBox()).y).toBeGreaterThan(markBounds.y);
    await add.click();
    expect(Math.abs((await mark.boundingBox()).y - markBounds.y)).toBeLessThanOrEqual(1);
    expectNoExecution(fixture);
  });
}

for (const width of [1440, 820, 390, 320]) {
  test(`approved highlights and compact index at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const projects = ["Quiet", "Running", "Unread", "Unavailable", "Another update"].map(name => libraryProject({ name }));
    const fixture = await boundaryLibrary(page, { projects, summary: {
      [projects[1].id]: { state: "running", running: true, runningLeaders: 1, activeLeaders: 1, activeCrew: 2 },
      [projects[3].id]: { state: "unknown", freshness: "unknown", running: null, unread: null },
    } });
    for (const index of [1, 2, 4]) fixture.events.set(projects[index].id, [contextEvent(projects[index].id, `Latest recorded update for ${projects[index].name}`)]);
    for (const index of [1, 2, 4]) fixture.leaderPreviews.set(projects[index].id, Array.from({ length: 3 }, (_, i) => ({ workItemId: `work-${index}-${i}`, title: `Leader session ${i + 1}`, at: Date.now() - i * 60000 })));
    await fixture.goto();
    const highlights = page.getByRole("region", { name: "Recent conversations", exact: true });
    await expect(highlights.getByRole("article")).toHaveCount(3);
    await expect(page.locator(".pl-index-row")).toHaveCount(5);
    await expect(page.getByRole("group", { name: "Project layout" })).toHaveCount(0);
    await expect(card(page, "Running").getByRole("button", { name: "Running", exact: true })).toBeVisible();
    await expect(card(page, "Unavailable").getByText("Status unavailable")).toBeVisible();
    const row = await card(page, "Quiet").boundingBox();
    expect(row.height).toBeLessThanOrEqual(width > 720 ? 64 : 100);
    const feature = await highlights.getByRole("article").first().boundingBox();
    expect(feature.height, "One conversation per card keeps the index close").toBeLessThanOrEqual(132);
    await expect(highlights.getByRole("button", { name: /^Open leader session:/ })).toHaveCount(3);
    const expand = highlights.getByRole("button", { name: "Show more conversations" });
    await expand.focus(); await page.keyboard.press("Enter");
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await expect(highlights.getByRole("button", { name: /^Open leader session:/ })).toHaveCount(9);
    await highlights.getByRole("button", { name: "Show fewer conversations" }).click();
    await expect(highlights.getByRole("button", { name: /^Open leader session:/ })).toHaveCount(3);
    const sort = page.getByLabel("Sort projects", { exact: true });
    await expect(page.locator(".pl-section-heading").filter({ has: sort })).toContainText("All projects");
    for (const scale of [1, 2]) {
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${16 * scale}px`; }, scale);
      await noHorizontalOverflow(page);
      const geometry = await card(page, "Running").evaluate(el => {
        const status = el.querySelector(".pl-index-state").getBoundingClientRect();
        const unread = el.querySelector(".pl-index-unread").getBoundingClientRect();
        return Math.max(status.left, unread.left) < Math.min(status.right, unread.right) && Math.max(status.top, unread.top) < Math.min(status.bottom, unread.bottom);
      });
      expect(geometry).toBe(false);
    }
    await page.getByRole("searchbox", { name: "Search projects" }).fill("Quiet");
    await expect(highlights).toHaveCount(0);
    await expect(page.locator(".pl-index-row")).toHaveCount(1);
    expectNoExecution(fixture);
  });
}

test("leader highlight padding opens the project, item rows open exact items, new opens unread", async ({ page }) => {
  const project = libraryProject({ name: "Leader navigation" });
  const workItem = { id: "leader-target", projectId: project.id, projectPath: project.path, title: "Selected leader",
    lifecycle: { runtimeState: "inactive", outcome: "completed", resolution: "reviewed", changeMode: "live", integrationState: "live_clean", lifecycleRevision: 1 },
    waitKind: null, currentRunKey: null, iteration: 1, lastTransitionAt: 1, createdAt: 1, updatedAt: 1 };
  const fixture = await boundaryLibrary(page, { projects: [project], workItems: [workItem] });
  fixture.leaderPreviews.set(project.id, [{ workItemId: "leader-target", title: "Selected leader", at: Date.now() }]);
  fixture.events.set(project.id, [contextEvent(project.id)]);
  await fixture.goto();
  const highlight = () => page.getByRole("article", { name: "Recent conversations for Leader navigation", exact: true });
  await expect(highlight().locator("footer")).toHaveCount(0);
  // Real hit test in the card's outer padding, not a programmatic DOM click.
  await highlight().click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
  expect(await page.evaluate(id => JSON.parse(sessionStorage.getItem(`swarmcrews:project-destination:${id}`)), project.id)).toEqual({ view: "activity" });
  await fixture.goto();
  await highlight().getByRole("button", { name: "Open leader session: Selected leader", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
  expect(await page.evaluate(id => JSON.parse(sessionStorage.getItem(`swarmcrews:project-destination:${id}`)), project.id)).toEqual({ view: "activity", workItemId: "leader-target" });
  await fixture.goto();
  await highlight().getByRole("button", { name: /1 new updates.*from highlights/ }).click();
  await expect(page.getByRole("dialog", { name: "Updates · Leader navigation", exact: true })).toBeVisible();
  expect(fixture.calls.some(call => call.pathname.endsWith("/acknowledge"))).toBe(false);
  expectNoExecution(fixture);
});
