import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync(new URL("./library-index.css", import.meta.url), "utf8");
it("uses three highlights and compact single-line desktop rows rather than full-size cards", () => {
  expect(css).toMatch(/\.pl-highlight-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
  expect(css).toMatch(/\.pl-index-row\s*\{[^}]*min-height: 52px/);
  expect(css).not.toMatch(/\.pl-index-row\s*\{[^}]*(?:min-block-size: 14rem|height: 224px)/);
  expect(css).toMatch(/\.pl-index-name::after\s*\{[^}]*position: absolute;[^}]*inset: 0/);
});
it("keeps mobile highlights horizontally accessible and all row actions touch-sized", () => {
  expect(css).toMatch(/@container library \(max-width: 720px\)/);
  expect(css).toMatch(/\.pl-highlight-grid\s*\{[^}]*overflow-x: auto/);
  expect(css).toMatch(/\.pl-index-row\s*\{[^}]*grid-template-rows: minmax\(44px, auto\) minmax\(44px, auto\)/);
});

it("keeps leader highlights content-sized and gives the project hit area lower priority than item/new actions", () => {
  expect(css).not.toContain(".pl-highlight-card footer");
  expect(css).not.toContain(".pl-highlight-headline");
  expect(css).not.toContain("min-block-size: 13rem");
  expect(css).toMatch(/\.pl-highlight-project::after\s*\{[^}]*position: absolute;[^}]*inset: 0/);
  expect(css).toMatch(/\.pl-highlight-card \.pl-highlight-new, \.pl-highlight-card \.pl-highlight-session\s*\{[^}]*position: relative;[^}]*z-index: 1/);
});

it("does not light the entire project when a nested control receives focus or hover", () => {
  expect(css).not.toContain(".pl-highlight-card:focus-within");
  expect(css).not.toContain(".pl-index-row:focus-within");
  expect(css).not.toContain(".pl-index-row:hover");
  const library = readFileSync(new URL("./library.css", import.meta.url), "utf8");
  expect(library).toContain("button:where(:not(.pl-project-action, .pl-inline-action)):hover:not(:disabled)");
});
