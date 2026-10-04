import { expect, test } from "@playwright/test";
import { openResponsiveFixture } from "./responsive-fixture.mjs";

for (const width of [1440, 390]) {
  test(`thinking streams as flowing prose rather than vertical fragments at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fixture = await openResponsiveFixture(page, { assistantText: "Ready to inspect the layout." });
    await page.getByRole("button", { name: "Review request: Improve responsive layouts across laptop screens", exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    const feed = page.getByRole("region", { name: "Conversation messages" });
    const body = feed.getByLabel("Streaming thinking");
    for (const text of ["I", " need", " to", " in", "spect", " the", " layout."]) {
      fixture.send({ type: "sdk_event", sessionKey: "layout-0",
        event: { kind: "thinking_delta", text, blockIndex: 0 } });
    }
    await expect(body).toHaveText("I need to inspect the layout.");
    const geometry = await body.evaluate(el => {
      const node = el.firstChild;
      const word = (start, end) => {
        const range = document.createRange();
        range.setStart(node, start); range.setEnd(node, end);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y };
      };
      return { first: word(0, 1), second: word(2, 6), width: el.getBoundingClientRect().width,
        textNodes: el.childNodes.length, whiteSpace: getComputedStyle(el).whiteSpace };
    });
    expect(geometry.textNodes).toBe(1);
    expect(geometry.width).toBeGreaterThan(200);
    expect(geometry.second.y).toBeCloseTo(geometry.first.y, 0);
    expect(geometry.second.x).toBeGreaterThan(geometry.first.x);
    expect(geometry.whiteSpace).toBe("pre-wrap");
    await expect(feed.getByRole("button", { name: /Thinking/ })).toHaveCount(0);
    fixture.send({ type: "sdk_event", sessionKey: "layout-0", event: { kind: "thinking", text: "I need to inspect the layout." } });
    await expect(body).toHaveCount(0);
    await expect(feed.getByRole("button", { name: /Thinking/ })).toBeVisible();
  });
}
