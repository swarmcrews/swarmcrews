import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing rule: ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
};

// jsdom cannot verify hover/media layout. Pin the shared styling contract here;
// browser coverage exercises the rendered controls at desktop and touch sizes.
describe("shared action button styling", () => {
  it("loads the zero-specificity reset before shared buttons so it cannot erase their padding", () => {
    const css = read("./index.css");
    // :where(...) and * both have zero specificity: source order decides.
    expect(css.trimStart().startsWith('@import "./reset.css";')).toBe(true);
    expect(css.indexOf('@import "./reset.css";')).toBeLessThan(css.indexOf('@import "./button.css";'));
    expect(css).not.toMatch(/\*::after\s*\{[^}]*padding:\s*0/);
    const reset = rule(read("./reset.css"), "*::after");
    expect(reset).toContain("padding: 0");
    expect(reset).toContain("margin: 0");
    expect(reset).toContain("box-sizing: border-box");
    expect(read("./button.css")).toContain("padding: 6px var(--button-padding-inline)");
  });

  it("loads for both route shells and leaves row controls and tabs out of the sizing reset", () => {
    expect(read("./index.css")).toContain('@import "./button.css"');
    const css = read("./button.css");
    expect(css).toContain(".ui-button");
    expect(css).toContain(".act-toolbar-btn");
    expect(css).toContain(".tg-button");
    expect(css).toContain(".mob-mini-btn");
    expect(css).not.toMatch(/(?:^|\n)button\s*\{/);
    expect(css).not.toContain(".tg-tabs");
    expect(css).not.toContain(".skills-browser__row");
    expect(css).toContain("border-radius: var(--radius-control)");
    expect(css).toContain("min-height: var(--button-height)");
  });

  it("keeps shared hover and press feedback unavailable to disabled controls", () => {
    const css = read("./button.css");
    for (const state of ["hover", "active"]) {
      const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(match => match[1]!.trim());
      const interactive = selectors.filter(selector => selector.includes(`:${state}`));
      expect(interactive.length).toBeGreaterThan(0);
      for (const selector of interactive) {
        expect(selector).toContain(":not(:disabled)");
        expect(selector).toContain(':not([aria-disabled="true"])');
      }
    }
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("pointer: coarse");
  });

  it("reveals copy actions for keyboard, feedback and touch, not just hover", () => {
    const css = read("./components/content-actions.css");
    expect(css).toContain(".copyable:focus-within .copy-btn");
    expect(css).toContain(".copy-btn:focus-visible");
    expect(css).toContain('.copy-btn[data-feedback="true"]');
    expect(css).toContain("@media (hover: none), (pointer: coarse)");
    expect(css).toContain("--content-action-size: 44px");
    expect(css).toContain("--content-action-offset: 52px");
    expect(css).toContain('has(> .copy-btn[data-layout="absolute"])');
    expect(css).toContain("padding-top: 52px !important");
    expect(css).toContain("height: var(--content-action-size)");
  });

  it.each([
    ["./activity.css", ".act-launch-btn"],
    ["./activity.css", ".act-toolbar-btn"],
    ["./activity.css", ".act-btn"],
    ["./changes-view.css", ".changes-btn"],
    ["./project-list.css", ".project-list-primary-action"],
  ])("keeps %s %s on theme-aware control geometry", (path, selector) => {
    const body = rule(read(path), selector);
    // Families may inherit the shared radius or explicitly use the same token.
    expect(body).not.toMatch(/border-radius:\s*\d+px/);
  });
});
