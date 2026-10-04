import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openDesignFinishFixture } from "./design-finish-fixture.mjs";

async function capture(page, testInfo, name) {
  await page.evaluate(() => document.fonts.ready);
  const directory = process.env.DESIGN_FINISH_OUTPUT_DIR;
  if (directory) fs.mkdirSync(directory, { recursive: true });
  const file = directory ? path.join(directory, `${name}.png`) : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, animations: "disabled" });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
}

for (const theme of ["Midnight", "Daybook"]) {
  test(`decision and graph reading roles remain legible in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDesignFinishFixture(page);
    if (theme === "Daybook") {
      await page.getByRole("button", { name: "Open settings", exact: true }).click();
      await page.getByRole("button", { name: /^Daybook/ }).click();
      await page.getByRole("button", { name: "Open settings", exact: true }).click();
    }
    await page.getByRole("button", { name: "Review request: Improve responsive layouts across laptop screens", exact: true }).click();
    await expect(page.locator(".act-inspector-meta .act-pill")).toBeVisible();
    await expect.poll(() => page.locator(".act-inspector-meta .act-pill").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    for (const width of [1440, 1024, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      await capture(page, testInfo, `conversation-${theme.toLowerCase()}-${width}`);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/m");
    await page.getByRole("button", { name: /Layout Review/ }).click();
    await page.getByRole("button", { name: /Improve responsive layouts/ }).click();
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await page.getByRole("button", { name: /Graph/ }).click();
    const inspector = page.getByRole("dialog", { name: "10-node research graph" });
    await expect(inspector).toBeVisible();
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
      for (const selector of [".tg-tabs button", ".tg-filterbar button", ".tg-run-status"]) {
        const element = inspector.locator(selector).first();
        await expect.poll(() => element.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
      }
      await capture(page, testInfo, `graph-${theme.toLowerCase()}-${width}`);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  });
}

for (const width of [1440, 320]) test(`project switcher has no opening subtext at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDesignFinishFixture(page);
  await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
  await expect(page.locator(".project-switcher__trigger")).toBeVisible();
  await expect(page.locator(".project-switcher")).not.toContainText(/opened/i);
  for (const name of ["Connections", "Skills", "Open settings"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await capture(page, testInfo, `project-switcher-${width}`);
  await page.getByRole("button", { name: "New", exact: true }).click({ timeout: 3000 });
  await expect(page.getByRole("region", { name: "New leader" })).toBeVisible();
});

test("browser zoom gestures belong to chrome and reading while Canvas gestures stay spatial", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDesignFinishFixture(page);
  const modifiedWheel = (locator) => locator.evaluate(el => {
    const event = new WheelEvent("wheel", { ctrlKey: true, deltaY: -80, bubbles: true, cancelable: true, clientX: 500, clientY: 400 });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await modifiedWheel(page.locator(".project-header"))).toBe(false);
  await page.getByRole("button", { name: "New", exact: true }).click();
  expect(await modifiedWheel(page.getByRole("textbox", { name: "Leader prompt" }))).toBe(false);
  await page.getByRole("tab", { name: "Canvas", exact: true }).click();
  const canvas = page.locator(".canvas-root");
  const camera = canvas.locator(':scope > div[style*="scale("]').first();
  const before = await camera.getAttribute("style");
  expect(await modifiedWheel(canvas)).toBe(true);
  await expect(camera).not.toHaveAttribute("style", before);
  const afterZoom = await camera.getAttribute("style");
  await canvas.evaluate(el => el.dispatchEvent(new WheelEvent("wheel", { deltaY: 60, deltaX: 22, bubbles: true, cancelable: true })));
  await expect(camera).not.toHaveAttribute("style", afterZoom);
  expect(await page.locator(".project-header").evaluate(el => {
    return ["ctrlKey", "metaKey"].every(modifier => ["+", "-", "0"].every(key => {
      const event = new KeyboardEvent("keydown", { key, [modifier]: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return !event.defaultPrevented;
    }));
  })).toBe(true); // DOM shortcut boundary, not an OS accelerator certification.
});

for (const theme of ["Midnight", "Daybook"]) test(`canonical patch evidence remains inspectable and stale-safe in ${theme}`, async ({ page }, testInfo) => {
  const { LEADER_DEFAULT_DATA } = await import('../../src/nodes/leader/types.ts');
  const entry = { id: 'canonical-fixture-contribution', lineageId: 'canonical-fixture-lineage', workItemId: 'audit-work',
    originatingRunKey: 'layout-0', runKeys: ['layout-0'], branchName: 'audit/worktree', worktreePath: 'C:/sample/worktree',
    baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), revision: 7, state: 'ready', reviewState: 'pending', cleanupState: 'retained', createdAt: 1, updatedAt: 1 };
  const lineage = { id: entry.lineageId, projectId: 'layout-review', repositoryPath: 'C:/sample/layout-review',
    targetRef: 'refs/heads/main', baseSha: entry.baseSha, integrationRef: 'refs/integration/fixture', integrationWorktreePath: 'C:/sample/integration',
    integrationHeadSha: entry.baseSha, revision: 1, integrationState: 'active', status: 'open',
    memberships: [{ workItemId: 'audit-work', status: 'active', revision: 1, actor: 'user', joinedAt: 1, leftAt: null }],
    resolutionRuns: [], contributions: [entry], queue: [], gates: [], reviews: [], createdAt: 1, updatedAt: 1 };
  const nodes = [{ id: 'review-leader', type: 'leader', position: { x: 100, y: 100 }, size: { width: 560, height: 600 },
    data: { ...LEADER_DEFAULT_DATA, sessionKey: 'layout-0', currentRunKey: 'layout-0', workItemId: 'audit-work',
      status: 'waiting', taskName: 'Improve responsive layouts across laptop screens', worktreeIsolation: true,
      worktreeStatus: 'active', worktreePath: entry.worktreePath, worktreeBranch: entry.branchName } }];
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openDesignFinishFixture(page, { nodes, lineage });
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  }
  await page.getByRole('button', { name: /Improve responsive layouts across laptop screens/, exact: false }).first().click();
  const context = page.getByRole('region', { name: 'Leader context' });
  await context.getByRole('tab', { name: 'Session details', exact: true }).click();
  const evidence = context.getByRole('region', { name: 'Contribution patch evidence' });
  await expect(evidence).toBeVisible();
  await expect(context.locator('.review-file__path').filter({ hasText: 'src/auth/session-recovery.ts' })).toHaveCount(1);
  const approval = context.getByRole('button', { name: '✓ Approve contribution', exact: true });
  await expect(approval).toBeEnabled();
  await evidence.getByText('src/auth/session-recovery.ts', { exact: true }).click();
  await expect(evidence.getByLabel('Patch for src/auth/session-recovery.ts')).toContainText('+reviewedPolicy');
  await evidence.getByText('src/deleted.ts', { exact: true }).click();
  await expect(evidence.getByLabel('Patch for src/deleted.ts')).toContainText('-removedPolicy');
  await evidence.getByText('assets/image.bin', { exact: true }).click();
  await expect(evidence.getByText('Binary file', { exact: true })).toBeVisible();
  await evidence.getByText('generated/large.ts', { exact: true }).click();
  await expect(evidence.getByText('Large file / patch omitted', { exact: true })).toBeVisible();
  await capture(page, testInfo, `canonical-desktop-${theme.toLowerCase()}`);
  fixture.failDiff(true);
  await evidence.getByRole('button', { name: 'Refresh contribution patch' }).click();
  await expect(approval).toBeDisabled();
  await expect(evidence.getByText(/Retained snapshot — not current/)).toBeVisible();
  await expect(evidence.getByLabel('Patch for src/auth/session-recovery.ts')).toContainText('+reviewedPolicy');
  fixture.failDiff(false);
  await evidence.getByRole('button', { name: 'Refresh contribution patch' }).click();
  await expect(approval).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Context Needs attention', exact: true }).click();
  await evidence.locator('.review-identity').scrollIntoViewIfNeeded();
  await capture(page, testInfo, `canonical-identity-320-${theme.toLowerCase()}`);
  await evidence.getByLabel('Patch for src/auth/session-recovery.ts').scrollIntoViewIfNeeded();
  await capture(page, testInfo, `canonical-desktop-320-${theme.toLowerCase()}`);
  await page.goto('/m');
  await page.getByRole('button', { name: /Layout Review/ }).click();
  await page.getByRole('button', { name: /Improve responsive layouts/ }).click();
  await expect(page.getByText('Thinking…', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  const mobileEvidence = page.getByRole('region', { name: 'Contribution patch evidence' });
  await expect(mobileEvidence).toBeVisible();
  await mobileEvidence.getByText('src/auth/session-recovery.ts', { exact: true }).click();
  await expect(mobileEvidence.getByLabel('Patch for src/auth/session-recovery.ts')).toContainText('+reviewedPolicy');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const element of [mobileEvidence, mobileEvidence.locator('.review-file__row').first(), page.getByRole('button', { name: '✓ Approve contribution', exact: true })]) {
      const bounds = await element.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await mobileEvidence.locator('.review-identity').scrollIntoViewIfNeeded();
    await capture(page, testInfo, `canonical-mobile-identity-${width}-${theme.toLowerCase()}`);
    await mobileEvidence.getByLabel('Patch for src/auth/session-recovery.ts').scrollIntoViewIfNeeded();
    await capture(page, testInfo, `canonical-mobile-${width}-${theme.toLowerCase()}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  expect(fixture.commands.some(command => /^(review_worktree|enqueue_worktree|promote_worktree|approve_changes|merge_worktree)/.test(command.type))).toBe(false);
});

for (const theme of ['Midnight', 'Daybook']) test(`native editor paint and attached run metadata stay coherent in ${theme}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openDesignFinishFixture(page);
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.locator('[data-dock-panel="skills"]').getByRole('button', { name: 'New skill' }).click();
  const editor = page.getByRole('dialog', { name: 'New Skill' });
  await expect(editor).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe(theme === 'Midnight' ? 'dark' : 'light');
  const checkbox = editor.getByRole('checkbox').first();
  await checkbox.scrollIntoViewIfNeeded();
  await expect(checkbox).toBeVisible();
  const paint = await checkbox.evaluate(element => {
    const style = getComputedStyle(element);
    const swatch = document.createElement('span'); swatch.style.color = 'var(--accent)'; document.body.append(swatch);
    const accent = getComputedStyle(swatch).color; swatch.remove();
    return { actual: style.accentColor, accent };
  });
  expect(paint.actual).toBe(paint.accent);
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await checkbox.scrollIntoViewIfNeeded();
    await capture(page, testInfo, `native-editor-${width}-${theme.toLowerCase()}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Review request: Improve responsive layouts across laptop screens', exact: true }).click();
  await page.getByRole('button', { name: 'Add to canvas', exact: true }).click();
  await page.getByRole('tab', { name: /^Activity(?: \d+)?$/ }).click();
  await page.getByRole('button', { name: 'Review request: Improve responsive layouts across laptop screens', exact: true }).click();
  await page.getByRole('button', { name: 'Expand fullscreen', exact: true }).click();
  const cockpit = page.getByRole('dialog', { name: 'Leader fullscreen cockpit' });
  await expect(cockpit).toContainText('gpt-6');
  await expect(cockpit).not.toContainText('claude-opus-4-8');
  await cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true }).fill('Preserve this draft across a matching sync.');
  fixture.send({ type: 'sync_response', sessionKey: 'layout-0', runKey: 'other-run', found: true, status: 'waiting', model: 'wrong-model', events: [] });
  await expect(cockpit).not.toContainText('wrong-model');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await expect(cockpit).toContainText('gpt-6');
    await expect(cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true })).toHaveValue('Preserve this draft across a matching sync.');
    await capture(page, testInfo, `recorded-fullscreen-${width}-${theme.toLowerCase()}`);
  }
});

for (const width of [1440, 320]) test(`legacy conflict strategies require recovered patch evidence at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openDesignFinishFixture(page);
  fixture.failDiff(true);
  await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
  await page.goto('/m');
  await page.getByRole('button', { name: /Layout Review/ }).click();
  await page.getByRole('button', { name: /Review authentication changes/ }).click();
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry loading changes' })).toBeVisible();
  fixture.send({ type: 'worktree_merge_failed', sessionKey: 'layout-1', result: {
    conflicts: ['src/recovery/long-conflict-path.ts'], summary: 'Fixture conflict; no real merge occurred', targetBranch: 'main',
  } });
  const conflict = page.getByRole('region', { name: 'Merge conflict' });
  for (const name of ['Retry', 'Force', 'Theirs']) await expect(conflict.getByRole('button', { name, exact: true })).toBeDisabled();
  await conflict.scrollIntoViewIfNeeded();
  await capture(page, testInfo, `legacy-conflict-failed-${width}`);
  fixture.failDiff(false);
  await page.getByRole('button', { name: 'Retry loading changes' }).click();
  for (const name of ['Retry', 'Force', 'Theirs']) await expect(conflict.getByRole('button', { name, exact: true })).toBeEnabled();
  await conflict.scrollIntoViewIfNeeded();
  await capture(page, testInfo, `legacy-conflict-recovered-${width}`);
  fixture.failDiff(true);
  await page.getByRole('button', { name: 'Refresh changes' }).click();
  for (const name of ['Retry', 'Force', 'Theirs']) await expect(conflict.getByRole('button', { name, exact: true })).toBeDisabled();
  expect(fixture.commands.some(command => ['retry_merge', 'force_merge', 'theirs_merge'].includes(command.type))).toBe(false);
});

for (const theme of ['Midnight', 'Daybook']) test(`approved Settings keyboard continuity in ${theme}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDesignFinishFixture(page);
  const opener = page.getByRole('button', { name: 'Open settings', exact: true });
  if (theme === 'Daybook') {
    await opener.click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await opener.click();
  }
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 900 });
    for (const category of ['General', 'Agent defaults', 'Workspace', 'Connections', 'Context actions', 'Governance']) {
      await opener.click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await expect(settings).not.toHaveAttribute('aria-modal', 'true');
      const item = settings.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: new RegExp(category) });
      await item.click();
      await expect(settings.getByRole('heading', { name: new RegExp(`^${category === 'Connections' ? 'Your tools, in every agent' : category}( Beta)?$`) })).toBeVisible();
      await item.focus();
      await expect(item).toBeInViewport({ ratio: 1 });
      if (category === 'Governance') await capture(page, testInfo, `settings-keyboard-${theme.toLowerCase()}-${width}`);
      await page.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
    await opener.click();
    const next = page.getByRole('tab', { name: 'Canvas', exact: true });
    await next.focus();
    await next.click();
    await expect(opener).not.toBeFocused();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Activity(?: \d+)?$/ }).click();
  }
});

for (const theme of ['Midnight', 'Daybook']) test(`approved phone graph operator lens and cancellation in ${theme}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDesignFinishFixture(page);
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/m');
  await page.getByRole('button', { name: /Layout Review/ }).click();
  await page.getByRole('button', { name: /Improve responsive layouts/ }).click();
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  const openGraph = page.getByRole('button', { name: /Graph/ });
  await openGraph.click();
  const inspector = page.getByRole('dialog', { name: '10-node research graph' });
  await expect(inspector.getByRole('tab', { name: 'Work queue' })).toHaveAttribute('aria-selected', 'true');
  await expect(inspector.locator('.tg-queue-row').first()).toBeInViewport({ ratio: 1 });
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await expect(inspector.getByRole('tab', { name: 'Work queue' })).toBeInViewport({ ratio: 1 });
    const cancel = inspector.getByRole('button', { name: 'Cancel run', exact: true });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await expect(inspector.getByRole('button', { name: 'Pause', exact: true })).toBeInViewport({ ratio: 1 });
    if (width <= 390) expect((await cancel.boundingBox()).height).toBeGreaterThanOrEqual(44);
    page.once('dialog', async dialog => { expect(dialog.message()).toContain('10-node research graph'); await dialog.dismiss(); });
    await cancel.click(); // Confirmation only; no cancellation is dispatched.
    await expect(inspector).toBeVisible();
    await capture(page, testInfo, `phone-queue-${theme.toLowerCase()}-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await inspector.getByRole('tab', { name: 'Flow', exact: true }).click();
  await inspector.getByRole('button', { name: 'Close graph inspector' }).click();
  await openGraph.click();
  await expect(inspector.getByRole('tab', { name: 'Flow', exact: true })).toHaveAttribute('aria-selected', 'true');
  await capture(page, testInfo, `phone-flow-preference-${theme.toLowerCase()}-320`);
});

for (const width of [1440, 320]) test(`Canvas legacy conflict controls retain patch evidence at ${width}px`, async ({ page }, testInfo) => {
  const { LEADER_DEFAULT_DATA } = await import('../../src/nodes/leader/types.ts');
  const nodes = [{ id: 'legacy-review-leader', type: 'leader', position: { x: 100, y: 100 }, size: { width: 560, height: 600 },
    data: { ...LEADER_DEFAULT_DATA, sessionKey: 'layout-1', currentRunKey: 'layout-1',
      status: 'waiting', taskName: 'Review authentication changes and session recovery', worktreeIsolation: true,
      worktreeStatus: 'active', worktreePath: 'C:/sample/worktree', worktreeBranch: 'audit/worktree' } }];
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openDesignFinishFixture(page, { nodes });
  await page.getByRole('button', { name: /Review authentication changes and session recovery/, exact: false }).first().click();
  await page.getByRole('button', { name: 'Expand fullscreen', exact: true }).click();
  const cockpit = page.getByRole('dialog', { name: 'Leader fullscreen cockpit' });
  fixture.failDiff(true);
  fixture.send({ type: 'worktree_merge_failed', sessionKey: 'layout-1', result: {
    conflicts: ['src/recovery/long-conflict-path.ts'], summary: 'Fixture conflict; no real merge occurred', targetBranch: 'main',
  } });
  await page.setViewportSize({ width, height: width === 320 ? 844 : 900 });
  await cockpit.getByRole('button', { name: 'Toggle context panel', exact: true }).click();
  await cockpit.getByTestId('drawer-tab-approval').click();
  const review = cockpit.getByRole('region', { name: 'Merge conflict review' });
  await expect(review).toBeVisible();
  const strategies = ['Keep Ours', 'Keep Main', 'Retry'];
  for (const name of strategies) await expect(review.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Retry loading changes' })).toBeVisible();
  fixture.failDiff(false);
  await review.getByRole('button', { name: 'Retry loading changes' }).click();
  await review.locator('.review-file__path').filter({ hasText: 'src/auth/session-recovery.ts' }).click();
  await expect(review.getByLabel('Patch for src/auth/session-recovery.ts')).toContainText('+reviewedPolicy');
  for (const name of strategies) await expect(review.getByRole('button', { name, exact: true })).toBeEnabled();
  await review.scrollIntoViewIfNeeded();
  await capture(page, testInfo, `canvas-legacy-review-${width}`);
  await review.getByRole('button', { name: 'Retry', exact: true }).scrollIntoViewIfNeeded();
  for (const name of strategies) {
    const control = review.getByRole('button', { name, exact: true });
    await expect(control).toBeInViewport({ ratio: 1 });
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await capture(page, testInfo, `canvas-legacy-strategies-${width}`);
  fixture.failDiff(true);
  await review.getByRole('button', { name: 'Refresh changes' }).click();
  for (const name of strategies) await expect(review.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(review.getByLabel('Patch for src/auth/session-recovery.ts')).toContainText('+reviewedPolicy');
  expect(fixture.commands.some(command => ['retry_merge', 'force_merge', 'theirs_merge'].includes(command.type))).toBe(false);
});

for (const theme of ['Midnight', 'Daybook']) test(`approved launch hierarchy preserves settings and draft in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await openDesignFinishFixture(page);
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  }
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const panel = page.getByRole('region', { name: 'New leader' });
  const prompt = panel.getByRole('textbox', { name: 'Leader prompt' });
  await prompt.fill('Retain my exact launch draft across all setup disclosures.');
  const advanced = panel.locator('.leader-launch-advanced');
  const before = async (first, second) => expect(await first.evaluate((el, selector) =>
    !!(el.compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING), second)).toBe(true);
  await before(prompt, '.leader-launch-workspace-section');
  await before(panel.getByRole('checkbox', { name: 'Isolated worktree', exact: true }), '.leader-launch-config-grid');
  for (const [width, fontSize] of [[1440, 16], [320, 16], [320, 32], [1440, 32]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
    await expect(advanced).not.toHaveAttribute('open');
    const summary = panel.getByRole('region', { name: 'Launch summary' });
    await summary.scrollIntoViewIfNeeded();
    await expect(summary).toContainText('Resolved when the session starts');
    await expect.poll(() => summary.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await summary.locator('dl > div').evaluateAll(rows => rows.every(row => {
      const label = row.querySelector('dt').getBoundingClientRect(), value = row.querySelector('dd').getBoundingClientRect();
      return label.right <= value.left + 1 || label.bottom <= value.top + 1;
    }))).toBe(true);
    await capture(page, info, `launch-desktop-${theme.toLowerCase()}-${width}-${fontSize}`);
    await advanced.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(advanced).toHaveAttribute('open');
    await panel.getByRole('combobox', { name: 'Orchestration', exact: true }).selectOption('plan');
    await expect(summary).toContainText('Graph — review before start');
    await advanced.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(prompt).toHaveValue('Retain my exact launch draft across all setup disclosures.');
    await expect(panel.getByRole('button', { name: 'Launch leader', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; });
  await page.goto('/m');
  await page.getByRole('button', { name: /Layout Review/ }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const mobile = page.getByRole('main', { name: 'New leader' });
  const mobilePrompt = mobile.getByRole('textbox', { name: 'Prompt', exact: true });
  await mobilePrompt.fill('Retain the phone draft while tuning setup.');
  await before(mobilePrompt, '.mob-launch-project');
  const mobileAdvanced = mobile.locator('[data-testid="launch-run-setup"]');
  for (const [width, fontSize] of [[320, 16], [1440, 16], [320, 32], [1440, 32]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
    await expect(mobileAdvanced).not.toHaveAttribute('open');
    const model = mobile.getByRole('combobox', { name: 'Model', exact: true });
    await expect(model).toBeVisible();
    expect(await model.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(fontSize);
    expect(await mobile.locator('.mob-control-help').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(fontSize * .75);
    const summary = mobile.getByRole('region', { name: 'Launch summary' });
    await summary.scrollIntoViewIfNeeded();
    await expect(summary).toContainText('Resolved when the session starts');
    await capture(page, info, `launch-mobile-${theme.toLowerCase()}-${width}-${fontSize}`);
    await mobileAdvanced.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(mobileAdvanced).toHaveAttribute('open');
    await mobileAdvanced.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(mobilePrompt).toHaveValue('Retain the phone draft while tuning setup.');
    const launch = mobile.getByRole('button', { name: 'Launch leader', exact: true });
    await launch.scrollIntoViewIfNeeded();
    await expect(launch).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
  expect(fixture.commands.filter(cmd => /^(launch_work_item|create_session|start_leader|approve_changes|promote)/.test(cmd.type))).toEqual([]);
});

for (const theme of ['Midnight', 'Daybook']) test(`Canvas context-first launch keeps a truthful setup summary in ${theme}`, async ({ page }, info) => {
  const { LEADER_DEFAULT_DATA } = await import('../../src/nodes/leader/types.ts');
  const nodes = [{ id: 'canvas-launch-fixture', type: 'leader', position: { x: 100, y: 100 }, size: { width: 560, height: 600 },
    data: { ...LEADER_DEFAULT_DATA, status: 'idle', taskName: 'Canvas launch fixture', model: 'claude-opus-4-8', prompt: 'Retained Canvas goal' } }];
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await openDesignFinishFixture(page, { nodes });
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  const cockpit = page.getByRole('dialog', { name: 'Leader fullscreen cockpit' });
  const prompt = cockpit.getByRole('textbox', { name: 'Leader prompt', exact: true });
  await prompt.fill('Retain my context-first Canvas goal.');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await cockpit.getByRole('button', { name: 'Toggle context panel', exact: true }).click();
    await cockpit.getByTestId('drawer-tab-worktree').click();
    const setup = cockpit.getByRole('button', { name: 'Run setup', exact: true });
    await setup.focus();
    await page.keyboard.press('Enter');
    await expect(setup).toHaveAttribute('aria-expanded', 'true');
    const summary = cockpit.getByRole('region', { name: 'Launch summary' });
    await summary.scrollIntoViewIfNeeded();
    await expect(summary).toContainText('Resolved when the session starts');
    await expect(summary).toContainText('Live working tree');
    await capture(page, info, `launch-canvas-${theme.toLowerCase()}-${width}`);
    await setup.focus();
    await page.keyboard.press('Enter');
    await cockpit.getByRole('button', { name: 'Toggle context panel', exact: true }).click();
    await expect(prompt).toHaveValue('Retain my context-first Canvas goal.');
  }
  expect(fixture.commands.filter(cmd => /^(launch_work_item|create_session|start_leader|approve_changes|promote)/.test(cmd.type))).toEqual([]);
});

for (const theme of ['Midnight', 'Daybook']) test(`combined lineage evidence gates final review across refresh and revision in ${theme}`, async ({ page }, testInfo) => {
  const { LEADER_DEFAULT_DATA } = await import('../../src/nodes/leader/types.ts');
  const entry = { id: 'combined-fixture-contribution', lineageId: 'combined-fixture-lineage', workItemId: 'audit-work',
    originatingRunKey: 'layout-0', runKeys: ['layout-0', 'archived-fixture-run'], branchName: 'audit/worktree', worktreePath: 'C:/sample/worktree',
    baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), revision: 7, state: 'integrated', reviewState: 'approved', cleanupState: 'cleaned', createdAt: 1, updatedAt: 1 };
  const lineage = { id: entry.lineageId, projectId: 'layout-review', repositoryPath: 'C:/sample/layout-review',
    targetRef: 'refs/heads/main', baseSha: entry.baseSha, integrationRef: 'refs/integration/fixture', integrationWorktreePath: 'C:/sample/integration',
    integrationHeadSha: 'c'.repeat(40), revision: 2, integrationState: 'active', status: 'open',
    memberships: [{ workItemId: 'audit-work', status: 'active', revision: 1, actor: 'user', joinedAt: 1, leftAt: null }],
    resolutionRuns: [], contributions: [entry], queue: [], gates: [], reviews: [], createdAt: 1, updatedAt: 1 };
  await page.setViewportSize({ width: 1440, height: 900 });
  const nodes = [{ id: 'combined-review-leader', type: 'leader', position: { x: 100, y: 100 }, size: { width: 560, height: 600 },
    data: { ...LEADER_DEFAULT_DATA, sessionKey: 'layout-0', currentRunKey: 'layout-0', workItemId: 'audit-work',
      status: 'waiting', taskName: 'Improve responsive layouts across laptop screens', worktreeIsolation: true,
      worktreeStatus: 'active', worktreePath: entry.worktreePath, worktreeBranch: entry.branchName } }];
  const fixture = await openDesignFinishFixture(page, { lineage, nodes });
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  }
  await page.getByRole('button', { name: /Improve responsive layouts across laptop screens/, exact: false }).first().click();
  const context = page.getByRole('region', { name: 'Leader context' });
  await context.getByRole('tab', { name: 'Session details', exact: true }).click();
  fixture.failDiff(true);
  await context.getByRole('button', { name: 'Expand lineage' }).click();
  const modal = page.getByRole('dialog', { name: /^Lineage combined/ });
  await expect(modal).toHaveAttribute('aria-modal', 'true');
  await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await modal.getByText('This leader', { exact: true }).click();
  const approve = modal.getByRole('button', { name: 'Approve combined lineage' });
  const evidence = modal.getByRole('region', { name: 'Combined lineage patch evidence' });
  await expect(approve).toBeDisabled();
  await expect(evidence.getByRole('alert')).toContainText('capture failed');
  fixture.failDiff(false);
  await evidence.getByRole('button', { name: 'Refresh combined patch' }).click();
  await expect(approve).toBeEnabled();
  await evidence.getByText('src/combined-result.ts', { exact: true }).click();
  await expect(evidence.getByLabel('Patch for src/combined-result.ts')).toContainText('+combinedResult');
  await expect(evidence.locator('.review-identity')).toContainText(lineage.integrationHeadSha);
  await expect(evidence.locator('.review-identity')).not.toContainText('Run');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await expect(modal).toBeVisible(); // U09: resize cannot conceal the open overlay.
    await expect(approve).toBeEnabled();
    await expect(evidence.getByLabel('Patch for src/combined-result.ts')).toContainText('+combinedResult');
    await evidence.locator('.review-identity').scrollIntoViewIfNeeded();
    await capture(page, testInfo, `combined-identity-${width}-${theme.toLowerCase()}`);
    await evidence.getByLabel('Patch for src/combined-result.ts').scrollIntoViewIfNeeded();
    await capture(page, testInfo, `combined-patch-${width}-${theme.toLowerCase()}`);
    await approve.scrollIntoViewIfNeeded();
    await expect(approve).toBeInViewport({ ratio: 1 });
    const bounds = await approve.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await capture(page, testInfo, `combined-action-${width}-${theme.toLowerCase()}`);
  }
  for (const selector of ['.lin-modal__tab', '.lin2-detail__grid dt', '.lin2-legend', '.lin-rev']) {
    const size = await modal.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
  }
  for (const control of [modal.getByRole('button', { name: 'Close', exact: true }), approve,
    evidence.getByRole('button', { name: 'Refresh combined patch' })]) {
    expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await page.evaluate(() => document.documentElement.style.fontSize = '32px');
  await evidence.locator('.review-identity').scrollIntoViewIfNeeded();
  await capture(page, testInfo, `combined-enlarged-320-${theme.toLowerCase()}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect((await modal.locator('.lin-modal__body').boundingBox()).height).toBeGreaterThanOrEqual(120);
  await approve.scrollIntoViewIfNeeded(); await expect(approve).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => document.documentElement.style.fontSize = '16px');
  fixture.failDiff(true);
  fixture.updateLineage({ ...lineage, revision: 3, integrationHeadSha: 'd'.repeat(40) });
  await expect(approve).toBeDisabled();
  await expect(evidence.getByText(/Retained snapshot — not current/)).toBeVisible();
  await expect(evidence.getByLabel('Patch for src/combined-result.ts')).toContainText('+combinedResult');
  fixture.failDiff(false);
  await evidence.getByRole('button', { name: 'Refresh combined patch' }).click();
  await expect(approve).toBeEnabled();
  await expect(evidence.locator('.review-identity')).toContainText('d'.repeat(40));
  expect(fixture.commands.some(q => /^(review_worktree|enqueue_worktree|promote_worktree|approve_changes|merge_worktree)/.test(q.type))).toBe(false);
  expect(fixture.commands.filter(q => q.type === 'get_integration_review_diff').every(q => !q.sessionKey && !q.runKey && !q.baseSha && !q.headSha)).toBe(true);
  const first = modal.getByRole('button', { name: '+ New lineage', exact: true });
  const last = modal.getByRole('button', { name: 'Request lineage changes', exact: true });
  await last.focus(); await page.keyboard.press('Tab'); await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
  await capture(page, testInfo, `lineage-focus-320-${theme.toLowerCase()}`);
  expect(await page.locator('#root').getAttribute('inert')).not.toBeNull();
  await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
  const contextToggle = page.getByRole('button', { name: 'Context Needs attention', exact: true });
  await expect(contextToggle).toBeFocused();
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await contextToggle.click(); await context.getByRole('button', { name: 'Expand lineage' }).click();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(context.getByRole('button', { name: 'Expand lineage' })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.getByRole('button', { name: 'Expand lineage' }).click();
  await expect(modal).toBeVisible();
  await page.locator('.lin-modal__backdrop').click({ position: { x: 8, y: 8 } });
  await expect(modal).toHaveCount(0);
  await expect(context.getByRole('button', { name: 'Expand lineage' })).toBeFocused();
});

for (const theme of ['Midnight', 'Daybook']) test(`contribution rejection remains available after capture failure in ${theme}`, async ({ page }, testInfo) => {
  const { LEADER_DEFAULT_DATA } = await import('../../src/nodes/leader/types.ts');
  const entry = { id: 'recovery-contribution', lineageId: 'recovery-lineage', workItemId: 'audit-work',
    originatingRunKey: 'layout-0', runKeys: ['layout-0'], branchName: 'audit/worktree', worktreePath: 'C:/sample/worktree',
    baseSha: 'b'.repeat(40), headSha: 'a'.repeat(40), revision: 7, state: 'ready', reviewState: 'pending', cleanupState: 'retained', createdAt: 1, updatedAt: 1 };
  const lineage = { id: entry.lineageId, projectId: 'layout-review', repositoryPath: 'C:/sample/layout-review',
    targetRef: 'refs/heads/main', baseSha: entry.baseSha, integrationRef: 'refs/integration/fixture', integrationWorktreePath: 'C:/sample/integration',
    integrationHeadSha: entry.baseSha, revision: 1, integrationState: 'active', status: 'open',
    memberships: [{ workItemId: 'audit-work', status: 'active', revision: 1, actor: 'user', joinedAt: 1, leftAt: null }],
    resolutionRuns: [], contributions: [entry], queue: [], gates: [], reviews: [], createdAt: 1, updatedAt: 1 };
  const nodes = [{ id: 'recovery-leader', type: 'leader', position: { x: 100, y: 100 }, size: { width: 560, height: 600 },
    data: { ...LEADER_DEFAULT_DATA, sessionKey: 'layout-0', currentRunKey: 'layout-0', workItemId: 'audit-work',
      status: 'waiting', taskName: 'Improve responsive layouts across laptop screens', worktreeIsolation: true,
      worktreeStatus: 'active', worktreePath: entry.worktreePath, worktreeBranch: entry.branchName } }];
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await openDesignFinishFixture(page, { nodes, lineage });
  if (theme === 'Daybook') {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await page.getByRole('button', { name: /^Daybook/ }).click();
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  }
  await page.getByRole('button', { name: /Improve responsive layouts across laptop screens/ }).first().click();
  const context = page.getByRole('region', { name: 'Leader context' });
  await context.getByRole('tab', { name: 'Session details', exact: true }).click();
  fixture.failDiff(true);
  await context.getByRole('button', { name: 'Expand lineage', exact: true }).click();
  const modal = page.getByRole('dialog', { name: /^Lineage recovery/ });
  await modal.getByText('This leader', { exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('capture failed');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    const approval = modal.getByRole('button', { name: 'Approve contribution', exact: true });
    const reject = modal.getByRole('button', { name: 'Request contribution changes', exact: true });
    await expect(approval).toBeDisabled(); await expect(reject).toBeEnabled();
    const before = fixture.commands.filter(command => command.type === 'review_worktree_contribution').length;
    await reject.focus(); await reject.press('Enter');
    await expect.poll(() => fixture.commands.filter(command => command.type === 'review_worktree_contribution').length).toBe(before + 1);
    expect(fixture.commands.at(-1)).toMatchObject({ type: 'review_worktree_contribution', contributionId: entry.id,
      expectedIntegrationRevision: entry.revision, decision: 'rejected', actor: 'user' });
    await capture(page, testInfo, `rejection-failed-${width}-${theme.toLowerCase()}`);
  }
  expect(fixture.commands.some(command => /^(enqueue_worktree|promote_worktree)/.test(command.type))).toBe(false);
  expect(fixture.commands.some(command => command.type === 'review_worktree_contribution' && command.decision === 'approved')).toBe(false);
});
