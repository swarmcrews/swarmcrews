import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themes } from "../themes.ts";
const css = ["library.css", "library-cards.css"].map(file => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n");
function luminance(hex: string) {
  expect(hex).toMatch(/^#[\da-f]{6}$/i);
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
}
function contrast(a: string, b: string) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
// Source/token evidence only. Browser-native paint and geometry still require E2E.
it.each(themes)("identifies Library text controls at 3:1 against fill and surrounding surface in $name", theme => {
  const rule = css.match(/\.pl-filters input, [^{]+\{([^}]+)\}/)![1]!;
  const borderToken = rule.match(/border:\s*1px solid var\((--[\w-]+)\)/)![1]!;
  for (const background of ["--bg-primary", "--bg-surface"]) {
    expect(contrast(theme.vars[borderToken]!, theme.vars[background]!), `${borderToken} vs ${background}`).toBeGreaterThanOrEqual(3);
  }
});

it.each(themes)("keeps Library reading and primary action text legible in $name", theme => {
  for (const background of ["--bg-primary", "--bg-surface", "--bg-secondary"]) {
    expect(contrast(theme.vars["--text-secondary"]!, theme.vars[background]!)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(theme.vars["--text-on-accent"]!, theme.vars["--accent"]!)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(theme.vars["--danger-color-text"]!, theme.vars["--bg-secondary"]!)).toBeGreaterThanOrEqual(4.5);
});

describe("content-first card visual contract (source evidence, not rendered geometry)", () => {
  it("keeps cards neutral and content-driven with a scalable project name", () => {
    const card = css.match(/\n\.pl-card\s*\{([^}]+)\}/)![1]!;
    expect(card).toContain("background: var(--bg-surface)");
    expect(card).not.toMatch(/(?:min-)?height\s*:/);
    expect(card).not.toMatch(/shadow|gradient|transform/);
    const name = css.match(/\.pl-card \.pl-name\s*\{([^}]+)\}/)![1]!;
    expect(name).toContain("font-size: 1.0625rem");
    expect(name).toContain("overflow-wrap: anywhere");
  });
  it("retains named 3→2→1 reflow and a separate horizontal list composition", () => {
    expect(css).toMatch(/container:\s*projects \/ inline-size/);
    expect(css).toMatch(/@container projects \(max-width: 820px\)/);
    expect(css).toMatch(/@container projects \(max-width: 510px\)/);
    expect(css).toMatch(/@container projects \(min-width: 700px\)/);
    expect(css).toMatch(/\.pl-projects--list \.pl-card--archived \.pl-archive-actions\s*\{[^}]*grid-column: 2/);
  });
  it("retains focus geometry and reduced-motion support across dialogs and cards", () => {
    expect(css).toMatch(/:focus-visible[^}]*outline: 2px solid var\(--accent\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
    const dialogs = readFileSync(new URL("./library-dialogs.css", import.meta.url), "utf8");
    expect(dialogs).toContain("overflow-y: auto");
    expect(dialogs).toContain("max-height: 100dvh");
    expect(dialogs).toContain("env(safe-area-inset-bottom)");
    expect(dialogs).not.toMatch(/outline:\s*none/);
  });
});

describe("finished page presentation", () => {
  const dialogs = readFileSync(new URL("./library-dialogs.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../project-list.css", import.meta.url), "utf8");
  const tutorial = readFileSync(new URL("../projects-tutorial.css", import.meta.url), "utf8");

  it.each(themes)("keeps notice, disclosure and toolbar text readable in $name", theme => {
    for (const [fg, bg] of [["--text-primary", "--bg-secondary"], ["--text-secondary", "--bg-secondary"], ["--text-secondary", "--bg-primary"]] as const) {
      expect(contrast(theme.vars[fg]!, theme.vars[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const tone of ["--status-error", "--status-warning", "--status-success"]) {
      expect(contrast(theme.vars[tone]!, theme.vars["--bg-secondary"]!), `${tone} marker`).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives every notice one tone-marked layout with touch-sized actions", () => {
    expect(css).toMatch(/\.pl-callout\[data-tone="error"\]\s*\{[^}]*--status-error/);
    expect(css).toMatch(/\.pl-callout button\s*\{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.pl-callout button\s*\{[^}]*min-width: 44px/);
    expect(css).not.toMatch(/\.project-library > \[role="(alert|status)"\]/);
  });

  it("scrolls only the dialog body so header and footer stay reachable", () => {
    expect(dialogs).toMatch(/\.pl-dialog\s*\{[^}]*overflow: hidden/);
    expect(dialogs).toMatch(/\.pl-dialog-body\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto/);
    expect(dialogs).toMatch(/\.pl-dialog > footer\s*\{[^}]*border-top/);
    expect(dialogs).not.toMatch(/position:\s*sticky/);
  });

  it("attaches the desk toolbar to its card and keeps its targets touch-sized", () => {
    expect(css).toMatch(/\.pl-project:has\(> \.pl-desk-actions\) > \.pl-card\s*\{[^}]*border-bottom-left-radius: 0/);
    expect(css).toMatch(/\.pl-desk-actions button\s*\{[^}]*min-width: 44px/);
  });

  it("styles the anchored registration action and drops unused page styles", () => {
    const layout = readFileSync(new URL("./library-layout.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.pl-heading-actions\s*\{[^}]*display: flex/);
    expect(layout).toMatch(/\.pl-registration-toggle\s*\{[^}]*min-height: 44px/);
    for (const stale of ["project-list-recent", "project-list-remove", "project-list-state", "project-list-count", "project-list-heading"]) {
      expect(page, stale).not.toContain(stale);
      expect(tutorial, stale).not.toContain(stale);
    }
    expect(page.match(/^\.project-list-header\s*\{/gm)).toHaveLength(1);
  });

  it("pauses skeleton motion for reduced-motion users", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.pl-skeleton-card > span\s*\{\s*animation: none/);
  });
});

describe("clickable cards and updates presentation", () => {
  const updates = readFileSync(new URL("./library-updates.css", import.meta.url), "utf8");
  const rule = (source: string, selector: string) => source.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("opens the project from anywhere on the card through one overlay on the name button", () => {
    expect(rule(css, ".pl-card")).toMatch(/position: relative/);
    expect(rule(css, ".pl-card .pl-name")).not.toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
    expect(rule(css, ".pl-card .pl-name::after")).toMatch(/position: absolute;\s*inset: 0;/);
    expect(rule(css, ".pl-card .pl-name::after")).toMatch(/content: ""/);
    expect(css).toMatch(/\.pl-card \.pl-more, \.pl-card \.pl-state, \.pl-card footer button, \.pl-card \.pl-restore\s*\{[^}]*position: relative;[^}]*z-index: 1/);
  });

  it("keeps the compact card flat while it is interactive", () => {
    const card = rule(css, ".pl-card");
    for (const decoration of [/height:/, /box-shadow/, /gradient/, /transform/]) expect(card).not.toMatch(decoration);
  });

  it("imports updates styles and keeps every update control touch-sized", () => {
    expect(css).toContain('@import "./library-updates.css";');
    for (const target of [".pl-dialog .pl-event-open", ".pl-dialog .pl-event-read", ".pl-dialog .pl-segmented button", ".pl-updates-bar button"]) {
      expect(updates, target).toContain(target);
    }
    expect(rule(updates, ".pl-dialog .pl-event-open")).toMatch(/min-height: 56px/);
    expect(rule(updates, ".pl-dialog .pl-event-read")).toMatch(/min-width: 44px/);
    expect(rule(updates, ".pl-dialog .pl-segmented button")).toMatch(/min-width: 44px/);
  });

  it("wraps long update text instead of clipping it and pauses skeleton motion", () => {
    expect(rule(updates, ".pl-event-text")).toMatch(/overflow-wrap: anywhere/);
    expect(rule(updates, ".pl-event-text")).not.toMatch(/line-clamp|text-overflow|white-space: nowrap/);
    expect(updates).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.pl-event-skeleton span\s*\{\s*animation: none/);
  });

  it.each(themes)("keeps update copy and unread accents legible in $name", theme => {
    for (const background of ["--bg-surface", "--bg-secondary", "--bg-primary"]) {
      expect(contrast(theme.vars["--text-primary"]!, theme.vars[background]!), `primary on ${background}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.vars["--text-secondary"]!, theme.vars[background]!), `secondary on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(theme.vars["--accent"]!, theme.vars["--bg-secondary"]!), "unread accent bar").toBeGreaterThanOrEqual(3);
  });
});

describe("Details sheet presentation", () => {
  const details = readFileSync(new URL("./library-details.css", import.meta.url), "utf8");
  const rule = (selector: string) => details.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

  it("is imported and scoped to the details dialog rather than leaking into other dialogs", () => {
    expect(css).toContain('@import "./library-details.css";');
    for (const selector of details.match(/^\.pl-dialog--details[^{]*/gm) ?? []) expect(selector).toMatch(/^\.pl-dialog--details/);
    expect(rule(".pl-dialog--details label:not(.pl-check)")).toMatch(/font-weight: 500/);
  });

  it("turns fieldsets into hairline-separated sections whose heading sits in flow, not cut into a border", () => {
    expect(rule(".pl-dialog--details fieldset")).toMatch(/border: 0;[^}]*border-top: 1px solid var\(--border-default\)/);
    expect(rule(".pl-dialog--details legend")).toMatch(/float: left;\s*width: 100%/);
    expect(details).toContain(".pl-dialog--details legend + * { clear: both; }");
  });

  it("renders collections as touch-sized toggle chips that show the checked state", () => {
    expect(rule(".pl-dialog--details .pl-check")).toMatch(/border-radius: 999px/);
    expect(css + readFileSync(new URL("./library-dialogs.css", import.meta.url), "utf8")).toMatch(/\.pl-dialog \.pl-check\s*\{[^}]*min-height: 44px/);
    expect(details).toMatch(/\.pl-check:has\(input:checked\)\s*\{[^}]*border-color: var\(--accent\)/);
  });

  it("lays organization actions out as an even grid that collapses on narrow screens, keeping archive separate", () => {
    expect(rule(".pl-org-group")).toMatch(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(rule(".pl-org-group--danger")).toMatch(/display: flex/);
    expect(details).toMatch(/@media \(max-width: 440px\)\s*\{\s*\.pl-org-group\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).not.toMatch(/^\.pl-org-/m);
  });

  it.each(themes)("keeps section headings legible and save-state markers visible in $name", theme => {
    expect(contrast(theme.vars["--text-secondary"]!, theme.vars["--bg-surface"]!), "section heading").toBeGreaterThanOrEqual(4.5);
    for (const marker of ["--status-warning", "--status-success"]) expect(contrast(theme.vars[marker]!, theme.vars["--bg-surface"]!), marker).toBeGreaterThanOrEqual(3);
    expect(contrast(theme.vars["--text-primary"]!, theme.vars["--bg-primary"]!), "chip text").toBeGreaterThanOrEqual(4.5);
  });
});

// Responsive source contracts supplement (but do not replace) browser geometry tests.
describe("contextual authoring finish", () => {
  const authoring = readFileSync(new URL("./library-authoring.css", import.meta.url), "utf8");
  it("keeps side sheets contextual on desktop and safe-area dialogs full-width on mobile", () => {
    expect(css).toContain('@import "./library-authoring.css"');
    expect(authoring).toMatch(/\.pl-dialog-backdrop--sheet\s*\{[^}]*justify-content: flex-end/);
    expect(authoring).toMatch(/@media \(max-width: 600px\)[\s\S]*max-height: 100dvh/);
    expect(authoring).toMatch(/\.pl-dialog \.pl-token-field > input\s*\{[^}]*min-height: 44px/);
    expect(authoring).not.toContain(".pl-card-description");
  });
  it("keeps full filter values outside clipped native controls and the creation picker scrollable", () => {
    expect(authoring).toMatch(/\.pl-filter-reset \.pl-filter-chip\s*\{[^}]*max-width: 100%/);
    expect(authoring).toMatch(/\.pl-collection-picker \.pl-chips\s*\{[^}]*overflow-y: auto/);
    expect(authoring).not.toMatch(/outline:\s*none|!important/);
  });
});

it("keeps activity separate from unread actions and allows enlarged labels to reflow", () => {
  expect(css).toMatch(/\.pl-card footer\s*\{[^}]*min-width: 0/);
  expect(css).toMatch(/\.pl-card footer\s*\{[^}]*flex-wrap: wrap/);
  expect(css).toMatch(/\.pl-state-label\s*\{[^}]*overflow-wrap: anywhere/);
  expect(css).toMatch(/\.pl-card-agents\s*\{[^}]*overflow-wrap: anywhere/);
  expect(css).toMatch(/\.pl-card \.pl-state\s*\{[^}]*min-height: 44px/);
});

it("aligns cards within each row without imposing a global height or empty status row", () => {
  expect(css).toMatch(/\.pl-projects\s*\{[^}]*align-items: stretch;[^}]*grid-auto-rows: auto/);
  expect(css).toMatch(/\.pl-project\s*\{[^}]*display: flex;[^}]*flex-direction: column/);
  expect(css).toMatch(/\.pl-card\s*\{[^}]*flex: 1/);
  expect(css).not.toContain("min-block-size: 14rem");
  expect(css).toMatch(/\.pl-card header\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 44px/);
  expect(css).not.toContain('.pl-card:not([data-state]) h3');
});

it.each(themes)("keeps project action text readable on resting, hover and pressed surfaces in $name", theme => {
  for (const background of ["--bg-surface", "--bg-secondary", "--bg-elevated"]) {
    for (const foreground of ["--text-primary", "--text-secondary"]) {
      expect(contrast(theme.vars[foreground]!, theme.vars[background]!), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
