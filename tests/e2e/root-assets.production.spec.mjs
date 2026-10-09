import { expect, test } from '@playwright/test';

for (const route of [
  { path: '/m', width: 390, mobile: true },
  { path: '/', width: 390, mobile: true },
  { path: '/?view=mobile', width: 1280, mobile: true },
  { path: '/?view=desktop', width: 1280, mobile: false },
]) {
  test(`production root loads its own styles at ${route.path} (${route.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: route.width, height: 844 });
    const requests = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    // No real projects, credentials, or agent sessions are touched.
    await page.route('**/api/**', request => {
      const path = new URL(request.request().url()).pathname;
      return request.fulfill({ json: path.endsWith('/auth/token') ? { token: 'asset-test' }
        : path === '/api/projects' || path.includes('skills') ? [] : {} });
    });
    await page.routeWebSocket('**/ws*', socket => socket.onMessage(() => {}));
    await page.goto(route.path);

    if (route.mobile) {
      await expect(page.locator('.mob-app')).toHaveCSS('display', 'flex');
      await expect(page.locator('.mob-app-header')).toHaveCSS('display', 'grid');
      await expect(page.locator('.mob-screen')).toHaveCSS('overflow-y', 'auto');
      expect(requests.some(path => /\/MobileApp-[^/]+\.css$/.test(path))).toBe(true);
      // Conditional import preloading must not accidentally select desktop CSS.
      expect(requests.filter(path => /\/App-[^/]+\.(js|css)$/.test(path))).toEqual([]);
    } else {
      await expect(page.locator('.project-list-page')).toBeVisible();
      expect(requests.some(path => /\/App-[^/]+\.css$/.test(path))).toBe(true);
      expect(requests.filter(path => /\/MobileApp-[^/]+\.(js|css)$/.test(path))).toEqual([]);
    }
  });
}
