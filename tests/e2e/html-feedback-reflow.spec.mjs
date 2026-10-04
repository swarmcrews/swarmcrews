import { test, expect } from '@playwright/test';
import { openDesignFinishFixture } from './design-finish-fixture.mjs';

// HTTP/WS and agent receipts are intercepted simulations, never real delivery.
for (const theme of ['Midnight', 'Daybook']) {
  test(`HTML feedback review and receipt keep labels and full focus inside the sidebar in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openDesignFinishFixture(page);
    if (theme === 'Daybook') {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click();
      await page.getByRole('button', { name: /^Daybook/ }).click();
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: /Improve responsive layouts across laptop screens/ }).first().click();
    fixture.send({ type: 'render_update', sessionKey: 'layout-0', leaderSessionKey: 'layout-0', action: 'set', components: [
      { id: 'receipt-reflow', type: 'html-artifact', title: 'SIMULATED feedback recovery', html: '<p>Subscribe</p>' },
    ] });
    await page.getByRole('tab', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Review & annotate' }).click();
    const review = page.getByRole('region', { name: 'HTML feedback workspace' });
    await review.getByText('Choose target', { exact: true }).click();
    await review.getByLabel('Keyboard target picker').selectOption({ label: 'p · Subscribe' });
    await review.getByText('Choose target', { exact: true }).click();
    const note = 'Preserve the original Subscribe target on explicit retry.';
    await review.getByLabel('What should change?').fill(note);
    await review.getByRole('button', { name: 'Review 1 note' }).click();
    const back = review.getByRole('button', { name: 'Continue annotating', exact: true });
    const observations = [];
    const collect = async (state) => {
      for (const [width, font] of [[1440, 16], [1440, 32], [800, 16], [800, 32], [320, 16], [320, 32]]) {
        await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
        await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px`; }, font);
        await review.locator('.hf-review-intro h3').scrollIntoViewIfNeeded();
        await review.locator('.hf-sidebar-body').evaluate(el => { el.scrollLeft = 0; });
        if (await back.isEnabled()) {
          await page.keyboard.press('Tab');
          await back.focus();
          await back.scrollIntoViewIfNeeded();
        }
        observations.push(await back.evaluate((el, context) => {
          const row = el.closest('.hf-review-intro');
          const body = el.closest('.hf-sidebar-body');
          const button = el.getBoundingClientRect();
          const bounds = body.getBoundingClientRect();
          const style = getComputedStyle(el);
          const ring = document.activeElement === el ? parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset) : 0;
          const textRange = document.createRange();
          textRange.selectNodeContents(el);
          const text = textRange.getBoundingClientRect();
          return { ...context, overflow: row.scrollWidth - row.clientWidth, bodyLeft: body.scrollLeft,
            ringLeft: button.left - ring - bounds.left, ringRight: bounds.right - button.right - ring,
            textFits: text.left >= button.left && text.right <= button.right && text.top >= button.top && text.bottom <= button.bottom,
            label: el.textContent, heading: row.querySelector('h3').textContent };
        }, { state, width, font }));
        await page.screenshot({ path: info.outputPath(`receipt-${state}-${width}-${font}.png`) });
      }
    };
    await collect('ready');
    const submit = review.getByRole('button', { name: 'Submit batch (1 note)' });
    await submit.click();
    const first = fixture.commands.filter(command => command.type === 'send_message').at(-1);
    await expect(back).toBeDisabled();
    await collect('pending');
    fixture.send({ type: 'control_response', command: 'send_message', sessionKey: 'layout-0', requestId: first.requestId, success: false, error: 'SIMULATED unavailable; retry retains the note.' });
    await expect(review).toContainText('SIMULATED unavailable');
    await collect('rejected');
    await submit.click();
    const second = fixture.commands.filter(command => command.type === 'send_message').at(-1);
    expect(second.prompt).toBe(first.prompt);
    expect(second.prompt).toContain(note);
    expect(second.requestId).not.toBe(first.requestId);
    fixture.send({ type: 'control_response', command: 'send_message', sessionKey: 'layout-0', requestId: second.requestId, success: true });
    await expect(review.getByRole('heading', { name: 'Feedback sent', exact: true })).toBeVisible();
    await collect('sent');
    await info.attach('receipt-geometry', { body: JSON.stringify(observations, null, 2), contentType: 'application/json' });
    for (const row of observations) {
      expect(row.overflow, JSON.stringify(row)).toBeLessThanOrEqual(1);
      expect(row.bodyLeft, JSON.stringify(row)).toBe(0);
      expect(row.ringLeft, JSON.stringify(row)).toBeGreaterThanOrEqual(0);
      expect(row.ringRight, JSON.stringify(row)).toBeGreaterThanOrEqual(0);
      expect(row.textFits, JSON.stringify(row)).toBe(true);
    }
    await back.press('Enter');
    await expect(review.getByRole('button', { name: 'Select', exact: true })).toBeFocused();
    await expect(review.getByRole('button', { name: 'Review 1 note' })).toBeEnabled();
    expect(fixture.commands.filter(command => command.type === 'send_message')).toHaveLength(2);
  });
}
