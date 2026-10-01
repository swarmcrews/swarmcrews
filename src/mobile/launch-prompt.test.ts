import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./launch-prompt.css", import.meta.url), "utf8");

// jsdom cannot measure touch targets or viewport overflow.
describe("mobile launch commands layout", () => {
  it("bounds the in-flow list and allows long custom labels to wrap", () => {
    expect(css).toMatch(/\.mob-launch-command-list\s*\{[^}]*max-height: min\(280px, 35dvh\);[^}]*overflow-y: auto;/);
    expect(css).toContain("overscroll-behavior: contain;");
    expect(css).toContain("overflow-wrap: anywhere;");
    expect(css).not.toMatch(/position:\s*(absolute|fixed)/);
  });

  it("keeps iteration commands above the composer row and limits their keyboard-open height", () => {
    expect(css).toMatch(/\.mob-composer > \.mob-launch-command-toolbar,[^}]*grid-column: 1 \/ -1;/);
    expect(css).toMatch(/\.mob-composer \.mob-launch-command-list\s*\{[^}]*max-height: min\(220px, 25dvh\);/);
  });

  it("keeps touch targets at least 44px tall", () => {
    expect(css).toMatch(/\.mob-launch-command-heading button\s*\{[^}]*min-height: 44px;/);
    expect(css).toMatch(/\.mob-launch-command-list button\s*\{[^}]*min-height: 52px;/);
  });
});
