import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./activity.css", import.meta.url), "utf8");

// jsdom has no layout engine. Pin the scoped sizing contract so the shared
// .act-btn { flex: 1 } rule cannot turn the fallback action into a full pane.
describe("Activity empty-state layout", () => {
  it("keeps the launch action content-sized on both flex axes", () => {
    const rule = css.match(/\.act-empty-add \.act-empty-launch\s*\{([^}]+)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toContain("flex: 0 0 auto");
    expect(rule).toContain("align-self: flex-start");
    expect(rule).toContain("min-height: 44px");
  });

  it("bounds the welcome content and lets short viewports scroll", () => {
    const welcome = css.match(/\.act-empty-workspace\.act-empty-workspace--welcome\s*\{([^}]+)\}/)?.[1];
    expect(welcome).toContain("overflow-y: auto");
    const content = css.match(/\.act-empty-workspace--welcome > \.act-empty-workspace__content\s*\{([^}]+)\}/)?.[1];
    expect(content).toContain("max-width: 640px");
  });
});
