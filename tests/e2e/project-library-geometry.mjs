import { expect } from "@playwright/test";

export async function tabTo(page, target, max = 90) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard could not reach ${await target.getAttribute("aria-label") ?? await target.textContent()}`);
}
export async function noHorizontalOverflow(page) {
  const width = page.viewportSize().width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  const overflow = await page.locator(".project-library, .pl-dialog, .pl-filters, .pl-projects, .pl-card, .pl-project-index, .pl-index-row, .pl-highlights, .pl-highlight-card, .pl-org-actions").evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ className: el.className, width: el.clientWidth, scroll: el.scrollWidth })));
  expect(overflow, "Actual surface reflow, not only document overflow").toEqual([]);
}
// Sample final computed paints, including transparent layers. The helper refuses
// gradient backgrounds rather than manufacturing a passing contrast value.
export async function paintSamples(locator) {
  return locator.evaluateAll(roots => {
    const rgba = color => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const over = (a, b) => { const alpha = a[3] / 255; return [0, 1, 2].map(i => a[i] * alpha + b[i] * (1 - alpha)).concat(255); };
    const background = el => {
      if (!el) return [255, 255, 255, 255]; const s = getComputedStyle(el);
      if (s.backgroundImage !== "none") throw new Error(`Unmeasured image/gradient paint: ${el.className}`);
      return over(rgba(s.backgroundColor), background(el.parentElement));
    };
    const luminance = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
    const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
    const visible = el => el.getClientRects().length && !el.closest("[hidden],[inert]") && getComputedStyle(el).visibility !== "hidden";
    const all = [...new Set(roots.flatMap(root => [root, ...root.querySelectorAll("*")]))].filter(visible);
    return all.filter(el => !el.matches(":disabled") && (el.matches("input,select,textarea") || [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))).map(el => {
      const s = getComputedStyle(el); const bg = background(el); const foreground = over(rgba(s.color), bg);
      const parentBg = background(el.parentElement);
      // Composite tag input is identified by its field boundary, not an extra nested input box.
      const field = el.closest(".pl-token-field") ?? el;
      const fieldStyle = getComputedStyle(field); const fieldParentBg = background(field.parentElement);
      const boundary = el.matches("input,select,textarea") ? Math.max(ratio(background(field), fieldParentBg), ratio(over(rgba(fieldStyle.borderTopColor), fieldParentBg), fieldParentBg)) : null;
      return { label: (el.getAttribute("aria-label") || el.textContent || el.value || el.tagName).trim().slice(0, 70), tag: el.tagName, textContrast: ratio(foreground, bg), boundaryContrast: boundary };
    });
  });
}
export async function assertPaint(locator, info, label) {
  const samples = await paintSamples(locator); expect(samples.length).toBeGreaterThan(0);
  console.log(`LIBRARY_PAINT ${label} ${JSON.stringify(samples)}`);
  await info.attach(label, { body: JSON.stringify(samples), contentType: "application/json" });
  expect(samples.filter(s => s.textContrast < 4.5), "All sampled visible text needs >=4.5:1").toEqual([]);
  expect(samples.filter(s => s.boundaryContrast !== null && s.boundaryContrast < 3), "Input/select/textarea identification needs >=3:1").toEqual([]);
}
export async function assertControlGeometry(locator, info, label) {
  const count = await locator.count(); expect(count).toBeGreaterThan(0); const measurements = [];
  for (let i = 0; i < count; i++) {
    const control = locator.nth(i); if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    await control.focus(); // Reveal contextual actions through their keyboard path before hit testing.
    await control.scrollIntoViewIfNeeded();
    const sample = await control.evaluate(el => {
      const s = getComputedStyle(el); const rect = el.getBoundingClientRect();
      const label = el.matches('input[type="checkbox"]') ? el.closest("label") : el;
      const target = label?.getBoundingClientRect() ?? rect;
      const center = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const canvas = document.createElement("canvas"); const ctx = canvas.getContext("2d"); ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const text = el.tagName === "SELECT" ? el.selectedOptions[0]?.textContent ?? "" : "Hg";
      const metrics = ctx.measureText(text);
      const availableHeight = rect.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth);
      return { label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 60), width: target.width, height: target.height,
        hit: !!center && (center === el || el.contains(center)), nativeHeight: availableHeight, glyphHeight: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        native: el.matches("select,input:not([type=checkbox]),textarea"), selected: text,
        valueClipped: el.tagName === "SELECT" && metrics.width > rect.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 4,
        disclosure: el.tagName === "SELECT" ? document.getElementById(el.getAttribute("aria-describedby"))?.textContent : null };
    });
    measurements.push(sample);
    expect(sample.width, `${sample.label} touch width`).toBeGreaterThanOrEqual(44);
    expect(sample.height, `${sample.label} touch height`).toBeGreaterThanOrEqual(44);
    expect(sample.hit, `${sample.label} unobscured actual hit geometry`).toBe(true);
    if (sample.native) expect(sample.nativeHeight + 1, `${sample.label} native glyph vertical clipping`).toBeGreaterThanOrEqual(sample.glyphHeight);
    if (sample.valueClipped) expect(sample.disclosure, `${sample.label} clipped native selected value requires visible full disclosure`).toBe(sample.selected);
  }
  console.log(`LIBRARY_GEOMETRY ${label} ${JSON.stringify(measurements)}`);
  await info.attach(label, { body: JSON.stringify(measurements), contentType: "application/json" });
}
export async function assertFocusRing(control, info) {
  const sample = await control.evaluate(el => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect(); const extension = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset));
    const clips = [];
    if (r.left - extension < 0 || r.right + extension > innerWidth || r.top - extension < 0 || r.bottom + extension > innerHeight) clips.push("viewport");
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const ps = getComputedStyle(parent); const p = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(ps.overflowX) && (r.left - extension < p.left || r.right + extension > p.right)) clips.push(parent.className + ":x");
      if (/(hidden|clip|auto|scroll)/.test(ps.overflowY) && (r.top - extension < p.top || r.bottom + extension > p.bottom)) clips.push(parent.className + ":y");
    }
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    let parent = el; while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)") parent = parent.parentElement;
    const bg = parent ? getComputedStyle(parent).backgroundColor : "rgb(255,255,255)";
    const a = luminance(s.outlineColor), b = luminance(bg);
    return { width: parseFloat(s.outlineWidth), style: s.outlineStyle, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), clips };
  });
  await info.attach("focus-ring", { body: JSON.stringify(sample), contentType: "application/json" });
  expect(sample.style).not.toBe("none"); expect(sample.width).toBeGreaterThanOrEqual(2); expect(sample.contrast).toBeGreaterThanOrEqual(3); expect(sample.clips).toEqual([]);
}
