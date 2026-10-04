import { describe, expect, it } from "vitest";
import { MARKUP_PALETTE, markupNumberForeground } from "./markup-palette.ts";

const luminance = (hex: string) => [0, 2, 4].map(offset => {
  const value = parseInt(hex.slice(offset + 1, offset + 3), 16) / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i]!, 0);

describe("markup number contrast", () => {
  it.each(MARKUP_PALETTE)("keeps $label numbers above 4.5:1 without changing the swatch", ({ color }) => {
    const ink = markupNumberForeground(color), a = luminance(color), b = luminance(ink);
    expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
  });
  it("handles shorthand, light and dark persisted hexadecimal marks", () => {
    expect(markupNumberForeground("#fff")).toBe("#000000");
    expect(markupNumberForeground("#000000")).toBe("#ffffff");
    expect(markupNumberForeground("#3B82F6")).toBe("#000000");
  });
  it("does not fabricate contrast for CSS colors that require browser resolution", () => {
    expect(markupNumberForeground("var(--custom-mark)")).toBe("#ffffff");
    expect(markupNumberForeground("rgba(0,0,0,.5)")).toBe("#ffffff");
  });
});
