import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync(new URL("./library-interactions.css", import.meta.url), "utf8");

// Source contracts only. The browser suite covers computed cascade and hit testing.
it("gates hover by pointer capability without moving hit areas or adding sticky parent state", () => {
  const hover = css.slice(css.indexOf("@media (hover: hover)"), css.indexOf("/* Keyboard focus"));
  expect(hover).toContain("and (pointer: fine)");
  expect(hover).toContain(".pl-highlight-card:has(.pl-project-action:hover)");
  expect(hover).toContain(".pl-index-row:has(.pl-project-action:hover)");
  expect(hover).toContain(".pl-inline-action:hover:not(:disabled)");
  expect(css).not.toMatch(/(?:transform|transition:\s*all|text-decoration):/);
  expect(css).not.toContain(":focus-within");
});
it("uses separate inset keyboard rings, theme-native badges, and reduced-motion/forced-color handling", () => {
  expect(css).toMatch(/\.pl-project-action:focus-visible::after\s*\{[^}]*outline: 2px solid var\(--accent\);[^}]*outline-offset: -3px/);
  expect(css).toMatch(/\.project-library \.pl-inline-action:focus-visible\s*\{[^}]*outline: 2px solid var\(--accent\)/);
  expect(css).toContain(".pl-inline-action:active:not(:disabled)");
  expect(css).toContain("font-variant-numeric: tabular-nums");
  expect(css).toContain("var(--radius-pill)");
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
  expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*outline-color: Highlight/);
});
