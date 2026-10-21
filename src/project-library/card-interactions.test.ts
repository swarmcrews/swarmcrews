import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync(new URL("./library-cards.css", import.meta.url), "utf8");

it("reveals secondary actions on hover or keyboard focus only on fine-hover devices", () => {
  expect(css).toContain("@media (hover: hover) and (pointer: fine)");
  expect(css).toMatch(/\.pl-project \.pl-card-secondary\s*\{[^}]*opacity: 0;[^}]*pointer-events: none/);
  expect(css).toMatch(/\.pl-project:hover \.pl-card-secondary, \.pl-project:focus-within \.pl-card-secondary\s*\{[^}]*opacity: 1;[^}]*pointer-events: auto/);
  expect(css).toMatch(/@media \(any-pointer: coarse\)[^\n]*opacity: 1;[^\n]*pointer-events: auto/);
  expect(css).not.toMatch(/visibility:\s*hidden|display:\s*none/);
});

it("retains native keyboard focus, stable geometry and reduced motion", () => {
  expect(css).toContain(".pl-card .pl-name:focus-visible::after");
  expect(css).toContain("button:not(.pl-name):focus-visible");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  expect(css).toContain("@media (forced-colors: active)");
  for (const [, body] of css.matchAll(/[^{}]*(?:hover|focus-within)[^{}]*\{([^}]+)\}/g)) {
    expect(body).not.toMatch(/(?:height|width|padding|margin|display|position):/);
  }
});
