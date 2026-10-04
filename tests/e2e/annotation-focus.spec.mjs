import { test, expect } from '@playwright/test';

for (const theme of ['Midnight', 'Daybook']) test(`image palette separates selection and full keyboard focus in ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/auth/token')
    ? { token: 'fixture' } : { content: 'SIMULATED file fixture', size: 22, truncated: false } }));
  await page.goto(`/tests/e2e/design-craft-fixture.html?theme=${theme}`);
  // Mounted specimen scrolling belongs to its host, not the application's spatial Canvas.
  await page.locator('main').evaluate(el => { el.style.height = '100dvh'; el.style.overflowY = 'auto'; el.style.boxSizing = 'border-box'; });
  const image = page.getByTestId('image-node');
  await image.getByRole('textbox', { name: 'Annotation note' }).fill('Retained note for pin 1');
  const amber = image.getByRole('radio', { name: 'Amber' });
  await amber.click(); await expect(amber).toHaveAttribute('aria-checked', 'true');
  const blue = image.getByRole('radio', { name: 'Blue' });
  for (const [width, font] of [[1440, 16], [320, 16], [320, 32]]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, font);
    await page.keyboard.press('Tab'); await blue.focus(); await blue.scrollIntoViewIfNeeded();
    await expect(blue).toBeFocused(); await expect(blue).toHaveAttribute('aria-checked', 'false');
    const paint = await blue.evaluate(el => {
      const s = getComputedStyle(el), b = el.getBoundingClientRect();
      const parent = el.closest('[data-testid="annotation-sidebar"]').getBoundingClientRect();
      return { visible: el.matches(':focus-visible'), outline: s.outlineStyle, thickness: parseFloat(s.outlineWidth),
        offset: parseFloat(s.outlineOffset), clearance: Math.min(b.left - parent.left, parent.right - b.right),
        gap: parseFloat(getComputedStyle(el.parentElement).gap),
        viewport: Math.min(b.left, innerWidth - b.right, b.top, innerHeight - b.bottom) };
    });
    await page.screenshot({ path: info.outputPath(`image-blue-focus-${theme}-${width}-${font}.png`) });
    expect(paint.visible).toBe(true); expect(paint.outline).toBe('solid');
    expect(paint.thickness).toBeGreaterThanOrEqual(2);
    expect(paint.clearance).toBeGreaterThanOrEqual(paint.thickness + paint.offset);
    expect(paint.viewport).toBeGreaterThanOrEqual(paint.thickness + paint.offset);
    expect(paint.gap).toBeGreaterThanOrEqual(2 * (paint.thickness + paint.offset));
    await expect(amber).toHaveAttribute('aria-checked', 'true');
    await expect(image.getByRole('textbox', { name: 'Annotation note' })).toHaveValue('Retained note for pin 1');
    await page.keyboard.press('Space'); await expect(blue).toHaveAttribute('aria-checked', 'true');
    await expect(blue).toBeFocused(); await expect(blue).toHaveCSS('outline-style', 'solid');
    await page.screenshot({ path: info.outputPath(`image-selected-focus-${theme}-${width}-${font}.png`) });
    await amber.click(); // retain original selection for the opposing viewport
    const note = image.getByRole('textbox', { name: 'Annotation note' });
    await page.keyboard.press('Tab'); await note.focus(); await note.scrollIntoViewIfNeeded();
    await expect(note).toHaveCSS('outline-style', 'solid');
    const clearance = await note.evaluate(el => {
      const b = el.getBoundingClientRect(), side = el.closest('[data-testid="annotation-sidebar"]').getBoundingClientRect();
      return Math.min(b.left - side.left, side.right - b.right, b.top - side.top, side.bottom - b.bottom);
    });
    expect(clearance).toBeGreaterThanOrEqual(4);
    await expect(note).toHaveValue('Retained note for pin 1');
    await page.screenshot({ path: info.outputPath(`image-note-focus-${theme}-${width}-${font}.png`) });
    for (const name of ['Delete annotation', 'Clear all annotations']) {
      const control = image.getByRole('button', { name, exact: true });
      await control.focus(); await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible(); await expect(control).toHaveCSS('outline-style', 'solid');
      const edges = await control.evaluate(el => {
        const b = el.getBoundingClientRect(), side = el.closest('[data-testid="annotation-sidebar"]').getBoundingClientRect();
        return Math.min(b.left - side.left, side.right - b.right, b.top - side.top, side.bottom - b.bottom);
      });
      expect(edges).toBeGreaterThanOrEqual(4);
    }
    await page.screenshot({ path: info.outputPath(`image-footer-focus-${theme}-${width}-${font}.png`) });
  }
});
