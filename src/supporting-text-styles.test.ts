import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing rule: ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
};

// Source-level contracts only: jsdom cannot verify computed layout or contrast.
// Limit these rules to supporting copy, not transcript paragraphs or global text.
describe("supporting text hierarchy", () => {
  it.each([
    ["./activity.css", ".leader-launch-footer > span"],
    ["./activity.css", '.act-composer-inner > p[role="status"]'],
    ["./components/run-history-disclosure.css", ".run-history-index > p"],
    ["./mobile/mobile.css", ".mob-launch-error"],
  ])("gives %s %s explicit readable typography and wrapping", (path, selector) => {
    const body = rule(read(path), selector);
    expect(body).toContain("var(--text-size-ui)/var(--leading-ui) var(--font-sans)");
    expect(body).toContain("overflow-wrap: anywhere");
  });

  it("keeps the launch action aligned even with an empty readiness message", () => {
    const css = read("./activity.css");
    expect(rule(css, ".leader-launch-footer button")).toContain("margin-inline-start: auto");
    expect(rule(css, ".leader-launch-footer > span")).toContain("min-width: 0");
    expect(rule(css, '.leader-launch-footer > [data-needs-input="true"]')).toContain("var(--status-warning)");
  });

  it("keeps archive errors distinct and scopes history notes away from message bodies", () => {
    const css = read("./components/run-history-disclosure.css");
    expect(rule(css, '.run-history-archive > p[role="alert"]')).toContain("var(--status-error)");
    expect(css).not.toContain(".run-history-browser p,");
    expect(css).not.toContain(".run-history-child p,");
  });
});
