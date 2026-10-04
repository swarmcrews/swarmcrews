/**
 * Fixed colour palette for annotation markup.
 *
 * Kept small on purpose — the point is to pick *something* that stands
 * out on the underlying image, not to match a brand. Lives on its own
 * so the sidebar and any future reuse (PdfPageNode, WebPreviewNode)
 * can import without pulling in a specific UI container.
 */
export interface MarkupPaletteSwatch {
  label: string;
  color: string;
}

export const MARKUP_PALETTE: ReadonlyArray<MarkupPaletteSwatch> = [
  // Keep every swatch theme-independent so the accent cannot duplicate another colour.
  { label: "Pink", color: "#ec4899" },
  { label: "Red", color: "#ef4444" },
  { label: "Amber", color: "#f59e0b" },
  { label: "Green", color: "#10b981" },
  { label: "Blue", color: "#3b82f6" },
  { label: "Violet", color: "#8b5cf6" },
];

/** Choose the higher-contrast number ink without changing an annotation's color.
 * Palette and persisted hexadecimal marks are opaque; other CSS colors retain
 * the incumbent white ink rather than pretending to resolve browser paint. */
export function markupNumberForeground(color: string): "#000000" | "#ffffff" {
  let hex = color.replace(/^#/, "");
  if (/^[a-f\d]{3}$/i.test(hex)) hex = [...hex].map(value => value + value).join("");
  if (!/^[a-f\d]{6}$/i.test(hex)) return "#ffffff";
  const linear = [0, 2, 4].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722;
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? "#000000" : "#ffffff";
}
