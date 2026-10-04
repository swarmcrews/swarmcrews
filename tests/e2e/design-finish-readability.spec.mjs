import { test, expect } from '@playwright/test';
import { openDesignFinishFixture } from './design-finish-fixture.mjs';

async function selectTheme(page, name) {
  if (name !== 'Daybook') return;
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('button', { name: /^Daybook/ }).click();
  await page.keyboard.press('Escape');
}
async function insideViewport(locator, width) {
  const box = await locator.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(5);
  expect(box.x + box.width).toBeLessThanOrEqual(width - 5);
  const height = await locator.evaluate(() => innerHeight);
  expect(box.y).toBeGreaterThanOrEqual(5);
  expect(box.y + box.height).toBeLessThanOrEqual(height - 5);
}
for (const theme of ['Midnight', 'Daybook']) {
  test(`HTML note editing stays reachable and preserves target/request in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openDesignFinishFixture(page); await selectTheme(page, theme);
    await page.getByRole('button', { name: /Improve responsive layouts across laptop screens/ }).first().click();
    fixture.send({ type: 'render_update', sessionKey: 'layout-0', leaderSessionKey: 'layout-0', action: 'set', components: [
      { id: 'readability-html', type: 'html-artifact', title: 'Feedback simulation', html: '<h2>Specimen</h2><p>Subscribe</p>' },
    ] });
    await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Review & annotate' }).click();
    const review = page.getByRole('region', { name: 'HTML feedback workspace' });
    await review.getByText('Choose target', { exact: true }).click();
    await review.getByLabel('Keyboard target picker').selectOption({ label: 'p · Subscribe' });
    await review.getByText('Choose target', { exact: true }).click();
    const note = 'Preserve target and evidence. ' + 'unbrokenfeedbackvalue'.repeat(10);
    for (const [width, font] of [[1440, 16], [320, 16], [320, 32]]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font);
      await review.getByLabel('What should change?').fill(note);
      await review.getByRole('button', { name: 'Review 1 note' }).click();
      await expect(review.getByRole('heading', { name: 'Ready to send?' })).toBeFocused();
      await review.getByRole('button', { name: 'Continue annotating' }).click();
      const edit = review.getByRole('button', { name: 'Inspect note F01' });
      await page.keyboard.press('Tab'); await edit.focus(); await insideViewport(edit, width);
      await expect(edit).toHaveCSS('outline-style', 'solid');
      const ring = await edit.evaluate(el => {
        const box = el.getBoundingClientRect(), body = el.closest('.hf-sidebar-body').getBoundingClientRect();
        return { top: box.top - body.top, bottom: body.bottom - box.bottom };
      });
      expect(ring.top).toBeGreaterThanOrEqual(5); expect(ring.bottom).toBeGreaterThanOrEqual(5);
      await page.screenshot({ path: info.outputPath(`html-edit-focus-${width}-${font}-${theme}.png`) });
      await edit.click(); // no force: footer/picker must not intercept this recovery action
      await expect(review.getByLabel('What should change?')).toHaveValue(note);
      await expect(review.locator('.hf-target-summary')).toContainText('Subscribe');
      await page.screenshot({ path: info.outputPath(`html-editor-${width}-${font}-${theme}.png`) });
      const primary = review.getByRole('button', { name: 'Review 1 note' });
      expect(await primary.evaluate(el => getComputedStyle(el).color)).toBe(await primary.evaluate(el => {
        const probe = document.createElement('span'); probe.style.color = 'var(--text-on-accent)'; el.append(probe);
        const result = getComputedStyle(probe).color; probe.remove(); return result;
      }));
    }
    expect(fixture.commands.some(command => command.type === 'submit_html_feedback')).toBe(false);
  });
  test(`enlarged Context has complete visible focus in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDesignFinishFixture(page); await selectTheme(page, theme);
    await page.getByRole('button', { name: /Improve responsive layouts across laptop screens/ }).first().click();
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    for (const name of ['Conversation', 'Context Needs attention']) {
      const button = page.getByRole('button', { name, exact: true });
      await button.focus(); await insideViewport(button, 320);
      await expect(button).toBeFocused();
    }
  });
  test(`governance long evidence wraps and confirmation type scales in ${theme}`, async ({ page }) => {
    await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/auth/token')
      ? { token: 'fixture' } : { content: 'isolated file fixture', size: 21, truncated: false } }));
    await page.goto(`/tests/e2e/design-craft-fixture.html?theme=${theme}`);
    await page.getByRole('button', { name: 'Independent craft review Failed' }).click();
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      const reason = page.locator('.gate-strip__row p').first();
      expect(await reason.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await page.getByRole('button', { name: 'Open isolated confirmation' }).click();
    const confirm = page.getByRole('dialog', { name: 'Inspect long-value confirmation' });
    await expect(confirm.getByText('Inspect long-value confirmation', { exact: true })).toHaveCSS('font-size', '32px');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toHaveCSS('font-size', '26px');
    await page.keyboard.press('Escape'); await expect(confirm).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open isolated confirmation' })).toBeFocused();
  });
}

for (const theme of ['Midnight', 'Daybook']) test(`File Viewer keyboard collapse preserves selection, scroll and fetch in ${theme}`, async ({ page }, info) => {
  const calls = [];
  const fileText = Array.from({ length: 80 }, (_, i) => `row ${i} ` + 'unbrokenvalue'.repeat(30)).join('\n');
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/file')) calls.push(url.pathname + url.search);
    return route.fulfill({ json: url.pathname.endsWith('/auth/token') ? { token: 'fixture' }
      : { content: fileText, size: fileText.length, truncated: false } });
  });
  await page.goto(`/tests/e2e/design-craft-fixture.html?theme=${theme}`);
  const file = page.getByRole('region', { name: 'File specimen' });
  const contents = file.getByRole('region', { name: 'File contents' });
  await expect(contents).toContainText('row 79');
  const identity = calls[0]; expect(calls).toHaveLength(1);
  for (const [width, font] of [[1440, 16], [320, 16], [320, 32]]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px`; }, font);
    await contents.evaluate(el => { el.scrollTop = 70; });
    await contents.locator('[data-file-line]').first().evaluate(el => { el.scrollLeft = 60; });
    const collapse = file.getByRole('button', { name: 'Collapse file viewer' });
    await collapse.focus(); await page.keyboard.press('Enter');
    const expand = file.getByRole('button', { name: 'Expand file viewer' });
    await expect(expand).toBeFocused(); await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(expand).toHaveCSS('outline-style', 'solid');
    const ring = await expand.evaluate(el => {
      const b = el.getBoundingClientRect(), root = el.closest('section').getBoundingClientRect();
      return { left: b.left - root.left, right: root.right - b.right, top: b.top - root.top };
    });
    expect(ring.left).toBeGreaterThanOrEqual(4); expect(ring.top).toBeGreaterThanOrEqual(4);
    expect(ring.right).toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: info.outputPath(`file-expand-focus-${width}-${font}-${theme}.png`) });
    await page.keyboard.press('Space');
    await expect(collapse).toBeFocused(); await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(contents).toContainText('row 79');
    expect(await contents.evaluate(el => el.scrollTop)).toBe(70);
    expect(await contents.locator('[data-file-line]').first().evaluate(el => el.scrollLeft)).toBe(60);
    expect(calls).toEqual([identity]);
    const label = await file.locator('.file-viewer-kind').evaluate(el => ({
      width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, size: parseFloat(getComputedStyle(el).fontSize),
    }));
    expect(label.width).toBeGreaterThanOrEqual(label.size * 5);
    expect(label.height).toBeLessThanOrEqual(label.size * 3);
    await page.screenshot({ path: info.outputPath(`file-restored-${width}-${font}-${theme}.png`) });
  }
});
