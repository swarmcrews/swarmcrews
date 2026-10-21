import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const css = readFileSync(new URL("./library-layout.css", import.meta.url), "utf8");
const filters = readFileSync(new URL("./library.css", import.meta.url), "utf8");

describe("compact action rows (source contract; browser geometry tested separately)", () => {
  it("anchors add in a wrapping heading, with no open-state geometry changes", () => {
    expect(filters).toMatch(/\.pl-heading-actions\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap/);
    expect(css).toMatch(/\.pl-registration-panel:not\(\[hidden\]\)\s*\{[^}]*margin-block: 12px/);
    for (const [, body] of css.matchAll(/\.pl-registration-toggle\[aria-expanded="true"\][^{]*\{([^}]+)\}/g)) {
      expect(body).not.toMatch(/flex|width|order|position|grid|margin/);
    }
  });
  it("gives search twice the filter width, with narrow-screen fallback and separate sorting", () => {
    expect(filters).not.toContain("@container library (max-width: 1000px)");
    expect(filters).toContain("@container library (max-width: 44rem)");
    expect(filters).toMatch(/\.pl-filter-actions\s*\{[^}]*display: flex/);
    expect(filters).toMatch(/\.pl-filters--search-first\s*\{[^}]*grid-template-columns: minmax\(200px, 2fr\) minmax\(130px, 1fr\) minmax\(105px, 1fr\) auto/);
    expect(css).toContain(".pl-section-heading > .pl-sort");
  });
});
