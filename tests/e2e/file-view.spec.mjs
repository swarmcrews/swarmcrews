import { test, expect } from '@playwright/test';

const document = [
  '# Designing for focused work',
  '',
  'A workspace should make the important things easy to see, and the next step easy to take.',
  '',
  '## Principles',
  '',
  '- Keep context close to the work',
  '- Make progress visible',
  '- Protect uninterrupted reading',
  '',
  '## Getting started',
  '',
  'Open a project and create your first task. Keep your **project context** nearby.',
  '',
  '```typescript',
  'const workspace = { name: "Studio", status: "ready" };',
  '```',
  '',
  '> Good tools leave room to think.',
  '',
  '## Next steps',
  '',
  'Explore the workspace with your team.',
].join('\n');

async function serveFile(page, content = document) {
  await page.route('**/api/auth/token', route => route.fulfill({ json: { token: 'file-view-test' } }));
  await page.route('**/api/projects/**/file?*', async route => {
    expect(route.request().headers().authorization).toBe('Bearer file-view-test');
    await route.fulfill({ json: { content, truncated: false } });
  });
}

for (const theme of ['midnight', 'daybook']) {
  for (const width of [1440, 390]) {
    test(`document reader fits ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(id => localStorage.setItem('canvas-theme', id), theme);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await serveFile(page);
      await page.goto('/file-view?project=workspace&path=docs%2Fdesign-principles.md');
      await expect(page.getByRole('heading', { name: 'Designing for focused work', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (theme === 'daybook') {
        await expect(page.getByRole('region', { name: 'File controls' })).toHaveCSS('background-color', 'rgb(245, 247, 251)');
      }
      expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}

test('deep-linked source remains contained with a long file path and long lines', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveFile(page, `first line\n${'source '.repeat(100)}\nlast line`);
  const path = `src/${'a-long-directory-name/'.repeat(5)}example.ts`;
  await page.goto(`/file-view?project=workspace&path=${encodeURIComponent(path)}&line=2`);
  await expect(page.locator('#L2')).toBeVisible();
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('long documents scroll by wheel and outline navigation keeps the target visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await serveFile(page, `${document}\n\n${'A paragraph with room to read.\n\n'.repeat(60)}\n\n## Final section\n\nEnd of document.`);
  await page.goto('/file-view?project=workspace&path=docs%2Fguide.md');
  await expect(page.getByRole('heading', { name: 'Designing for focused work', exact: true })).toBeVisible();
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, 700);
  await expect.poll(() => page.locator('main').evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  const outline = page.getByRole('navigation', { name: 'On this page' }).first();
  await outline.getByRole('button', { name: 'Final section', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Final section', exact: true })).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Final section', exact: true })).toBeFocused();
});
