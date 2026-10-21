import { expect, test } from '@playwright/test';
import { legacyLibraryRoutes } from './project-library-fixture.mjs';
import { createGraphFixture } from '../../src/task-graph/fixtures.ts';

test.use({ isMobile: true, hasTouch: true });

// Deliberately exercise real layout with deterministic data, without launching
// agents or changing a user's projects through the development server.
const project = { id: 'mobile-layout', path: '/workspace/mobile-layout', name: 'Mobile layout workspace', hasSidecar: true, lastOpened: '2026-09-05T00:00:00Z' };
const sessions = [
  { workItemId: 'layout-work', sessionKey: 'layout-running', sessionId: null, role: 'leader', cwd: project.path, status: 'running', taskName: 'Improve mobile layouts and usability', model: 'gpt-6', totalCost: 1.24 },
  { sessionKey: 'layout-waiting', sessionId: null, role: 'leader', cwd: project.path, status: 'waiting', taskName: 'Review authentication changes', totalCost: 0.82 },
];

async function openWorkspace(page) {
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/auth/token') ? { token: 'layout-test' }
      : path === '/api/projects' ? [project]
      : path === '/api/readiness' ? { harnesses: [] }
      : path.endsWith('/mcp-servers') ? { entries: [], invalid: [], statuses: {} }
      : path.includes('skills') ? [] : {};
    return route.fulfill({ json });
  });
  await legacyLibraryRoutes(page, [project]);
  await page.routeWebSocket('**/ws*', socket => socket.onMessage(raw => {
    const message = JSON.parse(raw);
    if (message.type === 'get_task_graph_snapshot') {
      const snapshot = createGraphFixture(10);
      socket.send(JSON.stringify({ topic: 'work-item:layout-work', type: 'task_graph_snapshot', cause: 'navigation-test', workItemId: 'layout-work', snapshot, runId: snapshot.graphRunId, revision: snapshot.revision, timestamp: 1 }));
    }
    if (message.type === 'list_sessions') socket.send(JSON.stringify({ topic: message.projectId ? `project:${message.projectId}` : 'global', type: 'session_list', sessions, includeArchived: message.includeArchived === true }));
    if (message.type === 'sync_session') {
      const session = sessions.find(item => item.sessionKey === message.sessionKey);
      socket.send(JSON.stringify({ topic: `session:${message.sessionKey}`, type: 'sync_response',
        ...session, sessionKey: message.sessionKey, found: !!session, events: [] }));
    }
    if (message.type === 'list_work_items') socket.send(JSON.stringify({ topic: 'global', type: 'work_item_response', command: message.type, requestId: message.requestId, success: true, result: { projectId: project.id, items: [], nextCursor: null } }));
    if (message.type === 'list_harnesses') socket.send(JSON.stringify({ topic: 'global', type: 'harness_list', harnesses: [] }));
    if (message.type === 'create_work_item') socket.send(JSON.stringify({ topic: 'global', type: 'work_item_response',
      command: message.type, requestId: message.requestId, success: false, error: 'Connection lost. Try again.' }));
  }));
  await page.goto('/m');
  await page.getByRole('button', { name: /Mobile layout workspace/ }).click();
  await expect(page.getByRole('button', { name: /Improve mobile layouts and usability/ })).toBeVisible();
}

async function expectContained(page) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.mob-app, .mob-screen, .mob-chat, .mob-tabbar, .mob-app-header')]
    .filter(el => el.scrollWidth > el.clientWidth + 1)
    .map(el => el.className));
  expect(overflow).toEqual([]);
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toHaveCount(0);
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 844, height: 390 }]) {
  test(`mobile screens stay usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await openWorkspace(page);
    await expectContained(page);
    // Selection is optional, and exiting it clears the bulk action state.
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select Improve mobile layouts and usability' }).check();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: /Improve mobile layouts and usability/ }).click();
    await expect(page.getByRole('combobox', { name: 'Switch session' })).toBeVisible();
    await expect(page.locator('.mob-chat > .mob-session-switcher')).toHaveCount(0);
    await expectContained(page);
    const feed = await page.locator('.mob-chat-feed').boundingBox();
    expect(feed.height).toBeGreaterThan(70);
    await page.getByRole('button', { name: 'Back to activity', exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const launch = page.getByRole('button', { name: 'Launch leader', exact: true });
    const prompt = page.getByRole('textbox', { name: 'Prompt' });
    await expect(launch).toBeInViewport({ ratio: 1 });
    const promptTop = (await prompt.boundingBox()).y;
    await prompt.fill('Review the mobile navigation.');
    // Showing Discard draft must not shift the prompt under the user's finger.
    expect(Math.abs((await prompt.boundingBox()).y - promptTop)).toBeLessThan(1);
    await expectContained(page);
    await page.locator('.mob-launch-options > summary').click();
    await page.locator('.mob-launch-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(launch).toBeInViewport({ ratio: 1 });
    const setup = await page.locator('.mob-launch-options').boundingBox();
    const action = await page.locator('.mob-launch-action').boundingBox();
    expect(setup.y + setup.height).toBeLessThanOrEqual(action.y);
    await expectContained(page);
    await page.getByRole('button', { name: 'Back to activity', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Leave active draft?' })).toBeVisible();
    await page.getByRole('button', { name: 'Open draft', exact: true }).click();
    await expect(prompt).toHaveValue('Review the mobile navigation.');
    await page.getByRole('button', { name: 'Back to activity', exact: true }).click();
    await page.getByRole('button', { name: 'Leave and lose draft', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Activity', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Settings categories' })).toBeVisible();
    await page.getByRole('button', { name: /^Agent defaults/ }).click();
    await expect(page.getByRole('heading', { name: 'Agent defaults', level: 1 })).toBeVisible();
    await expectContained(page);
    const fonts = await page.locator('.mob-settings select').evaluateAll(els => els.map(el => parseFloat(getComputedStyle(el).fontSize)));
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every(size => size >= 16)).toBe(true);
    await page.getByRole('button', { name: 'Back to activity', exact: true }).click();
    await page.getByRole('button', { name: /Improve mobile layouts and usability/ }).first().click();
    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    await expectContained(page);
    expect(errors).toEqual([]);
  });
}

test('image preview keeps the mobile Send button reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  await page.getByRole('button', { name: /Improve mobile layouts and usability/ }).click();
  // A phone-sized screenshot must become a thumbnail, not displace the composer.
  const image = await page.screenshot();
  await page.getByLabel('File attachments', { exact: true }).setInputFiles({
    name: 'mobile-layout.png', mimeType: 'image/png', buffer: image,
  });
  const preview = page.getByRole('img', { name: 'mobile-layout.png', exact: true });
  await expect(preview).toBeVisible();
  expect((await preview.boundingBox()).height).toBeLessThanOrEqual(56);
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeEnabled();
  await expect(send).toBeInViewport({ ratio: 1 });
  await expectContained(page);
  await send.click();
  await expect(preview).toHaveCount(0);
});

test('chat composer and transcript fit above an on-screen keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page);
  await page.getByRole('button', { name: /Improve mobile layouts and usability/ }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this message visible');
  // Chromium desktop does not display an OS keyboard. Simulate the visual
  // viewport events browsers deliver when the keyboard covers the layout viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 360 });
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 10 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.mob-app')).toHaveAttribute('data-keyboard', 'open');
  await expect(page.getByRole('navigation', { name: 'Session views' })).toBeHidden();
  const composer = await page.locator('.mob-composer').boundingBox();
  const feed = await page.locator('.mob-chat-feed').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(370);
  expect(composer.height).toBeLessThan(180);
  expect(feed.height).toBeGreaterThan(80);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  await page.getByRole('textbox', { name: 'Message', exact: true }).blur();
  await page.evaluate(() => {
    delete window.visualViewport.height;
    delete window.visualViewport.offsetTop;
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.mob-app')).toHaveAttribute('data-keyboard', 'closed');
  await expect(page.getByRole('navigation', { name: 'Session views' })).toBeVisible();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`graph returns to Work without trapping navigation at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWorkspace(page);
    await page.getByRole('button', { name: /Improve mobile layouts and usability/ }).click();
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep my draft');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.getByRole('button', { name: /^Dashboard/ }).click();
    await page.getByRole('button', { name: /Graph/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close graph inspector' })).toBeInViewport();
    await page.goBack();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: /^Dashboard/ })).toHaveAttribute('aria-pressed', 'true');
    await page.goForward();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Close graph inspector' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Changes', exact: true }).click();
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep my draft');
    await page.getByRole('button', { name: 'Back to activity', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Activity', exact: true })).toBeVisible();
    await expectContained(page);
  });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`new leader keeps launch, attachments and retry feedback reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openWorkspace(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const prompt = page.getByRole('textbox', { name: 'Prompt' });
    const launch = page.getByRole('button', { name: 'Launch leader', exact: true });
    await prompt.fill('Preserve this draft and its files.');
    await page.getByLabel('Launch file attachments', { exact: true }).setInputFiles({
      name: 'context-with-a-deliberately-long-filename-for-a-narrow-phone.txt',
      mimeType: 'text/plain', buffer: Buffer.from('Launch context'),
    });
    const remove = page.getByRole('button', { name: /^Remove context-with/ });
    await expect(remove).toBeVisible();
    const target = await remove.boundingBox();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    await expect(launch).toBeInViewport({ ratio: 1 });

    await prompt.focus();
    // Simulate the same visual viewport events as an on-screen keyboard.
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 360 });
      Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 0 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('.mob-app')).toHaveAttribute('data-keyboard', 'open');
    const action = await page.locator('.mob-launch-action').boundingBox();
    expect(action.y + action.height).toBeLessThanOrEqual(360);
    expect(await page.locator('.mob-launch-scroll').evaluate(el => el.clientHeight)).toBeGreaterThan(100);
    await prompt.scrollIntoViewIfNeeded();
    await expect(prompt).toBeInViewport({ ratio: 1 });
    await expect(launch).toBeInViewport({ ratio: 1 });
    await expectContained(page);

    await launch.click();
    const error = page.getByRole('alert').filter({ hasText: 'Connection lost. Try again.' });
    await expect(error).toBeInViewport({ ratio: 1 });
    await expect(launch).toBeEnabled();
    await expect(launch).toBeInViewport({ ratio: 1 });
    // Moving focus to Launch must not drop the action behind a closing keyboard.
    const retryAction = await page.locator('.mob-launch-action').boundingBox();
    expect(retryAction.y + retryAction.height).toBeLessThanOrEqual(360);
    await expect(prompt).toHaveValue('Preserve this draft and its files.');
    await expect(remove).toHaveCount(1);
  });
}
