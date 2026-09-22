import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

async function openFullscreen(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openResponsiveFixture(page, {
    assistantText: Array.from({ length: 40 }, (_, i) =>
      `Paragraph ${i + 1}. Keep supporting information accessible and preserve room for the conversation. Verify controls, keyboard access, and scrolling at smaller sizes.`,
    ).join("\n\n"),
  });
  await page.getByRole("region", { name: "Recent work" }).getByRole("button", { name: /Improve responsive layouts across laptop screens/ }).click();
  await page.getByRole("button", { name: "Add to canvas", exact: true }).click();
  await page.getByRole("tab", { name: /^Activity(?: \d+)?$/ }).click();
  await page.getByRole("region", { name: "Recent work" }).getByRole("button", { name: /Improve responsive layouts across laptop screens/ }).click();
  await page.getByRole("button", { name: "Expand fullscreen", exact: true }).click();
  const overlay = page.getByRole("dialog", { name: "Leader fullscreen cockpit" });
  const feed = overlay.getByRole("region", { name: "Conversation messages" });
  await expect(feed.getByTestId("message-chunk")).toHaveCount(40);
  return { overlay, feed };
}

async function placeChunk(feed, index, offset) {
  await feed.evaluate((el, { index, offset }) => {
    const chunk = el.querySelectorAll("[data-chunk-id]")[index];
    el.scrollTop += chunk.getBoundingClientRect().top - el.getBoundingClientRect().top - offset;
  }, { index, offset });
  await expect.poll(() => feed.evaluate((el, index) =>
    el.querySelectorAll("[data-chunk-id]")[index].getBoundingClientRect().top - el.getBoundingClientRect().top,
  index)).toBeCloseTo(offset, 0);
}

async function geometry(feed) {
  return feed.evaluate(el => {
    const viewport = el.getBoundingClientRect();
    const controls = el.querySelector(".message-selection-toolbar__controls").getBoundingClientRect();
    const visible = [...el.querySelectorAll('[data-selected="true"]')]
      .map(chunk => chunk.getBoundingClientRect())
      .filter(rect => rect.bottom > viewport.top && rect.top < viewport.bottom);
    return {
      gap: controls.top - (visible.at(-1)?.bottom ?? 0),
      bottomGap: viewport.bottom - controls.bottom,
      inside: controls.top >= viewport.top && controls.bottom <= viewport.bottom
        && controls.left >= viewport.left && controls.right <= viewport.right,
    };
  });
}

test("fullscreen selection toolbar follows visible chunks without shifting text or retaining hidden focus", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const { overlay, feed } = await openFullscreen(page);
  const chunks = feed.getByTestId("message-chunk");
  const controls = feed.locator(".message-selection-toolbar__controls");
  await placeChunk(feed, 5, 120);
  const before = await chunks.nth(5).boundingBox();
  await chunks.nth(5).click();
  await expect(controls).toBeVisible();
  await expect.poll(async () => (await geometry(feed)).gap).toBeCloseTo(4, 0);
  expect(await chunks.nth(5).boundingBox()).toEqual(before);

  // A partially visible selection still owns the toolbar.
  await placeChunk(feed, 5, -10);
  await expect(controls).toBeVisible();
  await expect.poll(async () => (await geometry(feed)).gap).toBeCloseTo(4, 0);

  await overlay.getByRole("button", { name: "Copy selected chunks" }).evaluate(el => el.focus({ preventScroll: true }));
  await placeChunk(feed, 5, -200);
  await expect(controls).toBeHidden();
  await expect(controls).toHaveAttribute("inert", "");
  await expect(controls).toHaveAttribute("aria-hidden", "true");
  await expect(feed).toBeFocused();
  await expect(chunks.nth(5)).toHaveAttribute("aria-checked", "true");

  await placeChunk(feed, 5, 120);
  await expect(controls).toBeVisible();
  await expect(controls).not.toHaveAttribute("inert", "");
  await expect.poll(async () => (await geometry(feed)).gap).toBeCloseTo(4, 0);

  // Disjoint selections must not keep controls visible across an unselected gap.
  await chunks.nth(35).click();
  await placeChunk(feed, 5, -200);
  await expect(controls).toBeHidden();
  await placeChunk(feed, 5, 120);
  await expect(controls).toBeVisible();
  await expect.poll(async () => (await geometry(feed)).gap).toBeCloseTo(4, 0);

  // A range spanning the viewport sticks above its lower edge, even after reflow.
  await overlay.getByRole("button", { name: "Select all chunks" }).click();
  await expect.poll(async () => (await geometry(feed)).bottomGap).toBeCloseTo(4, 0);
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await placeChunk(feed, 5, 120);
    await expect(controls).toBeVisible();
    await expect.poll(async () => (await geometry(feed)).inside).toBe(true);
    await expect.poll(async () => (await geometry(feed)).bottomGap).toBeCloseTo(4, 0);
  }
  await overlay.getByRole("button", { name: "Clear selected chunks" }).click();
  await expect(controls).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Copy selected chunks" })).toBeDisabled();
  await overlay.getByRole("button", { name: "Exit chunk selection" }).click();
  await expect(controls).toBeHidden();
  expect(errors).toEqual([]);
});
