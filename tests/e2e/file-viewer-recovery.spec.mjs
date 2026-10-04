import { test, expect } from '@playwright/test';

for (const theme of ['Midnight', 'Daybook']) test(`File Viewer explicit retry preserves identity, pending guard and focus in ${theme}`, async ({ page }, info) => {
  let requests = [], pending = [];
  const error = 'SIMULATED read failure: /fixture/' + 'unbrokenpathvalue'.repeat(14);
  const text = Array.from({ length: 60 }, (_, i) => `row ${i} ` + 'codevalue'.repeat(35)).join('\n');
  let initial = true;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/token')) return route.fulfill({ json: { token: 'fixture' } });
    requests.push(url.pathname + url.search);
    if (initial) { initial = false; return route.fulfill({ status: 500, json: { error } }); }
    await new Promise(resolve => pending.push({ route, resolve }));
  });
  async function release(ok) {
    const { route, resolve } = pending.shift();
    await route.fulfill(ok ? { json: { content: text, size: text.length, truncated: false } }
      : { status: 503, json: { error } }); resolve();
  }
  for (const [width, font] of [[1440, 16], [320, 16], [320, 32]]) {
    initial = true; const before = requests.length;
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.goto(`/tests/e2e/design-craft-fixture.html?theme=${theme}`);
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font);
    const file = page.getByRole('region', { name: 'File specimen' });
    const contents = file.getByRole('region', { name: 'File contents' });
    await expect(contents).toContainText(error);
    await file.getByRole('button', { name: 'Collapse file viewer' }).click();
    await file.getByRole('button', { name: 'Expand file viewer' }).click();
    expect(requests.length - before).toBe(1);
    const retry = file.getByRole('button', { name: 'Retry file' });
    await page.keyboard.press('Tab'); await retry.focus();
    await expect(retry).toHaveCSS('outline-style', 'solid');
    expect(await file.locator('.file-viewer-error').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`file-error-${theme}-${width}-${font}.png`) });
    await page.keyboard.press('Enter'); await expect(retry).toBeDisabled();
    await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    await expect.poll(() => pending.length).toBe(1);
    expect(requests.length - before).toBe(2); await expect(retry).toBeFocused();
    await expect(contents).toHaveAttribute('aria-busy', 'true'); await expect(contents).toContainText(error);
    await page.screenshot({ path: info.outputPath(`file-pending-${theme}-${width}-${font}.png`) });
    await release(false); await expect(retry).toBeEnabled(); await expect(retry).toBeFocused();
    await page.keyboard.press('Space'); await expect.poll(() => pending.length).toBe(1);
    expect(requests.length - before).toBe(3);
    expect(new Set(requests.slice(before)).size).toBe(1);
    await release(true); await expect(contents).toContainText('row 59'); await expect(contents).toBeFocused();
    await expect(contents).toHaveAttribute('aria-busy', 'false');
    await expect(retry).toHaveCount(0);
    await expect(file.getByRole('button', { name: 'Collapse file viewer' })).toHaveAttribute('aria-expanded', 'true');
    await page.screenshot({ path: info.outputPath(`file-recovered-${theme}-${width}-${font}.png`) });
  }
});
