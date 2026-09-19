import type { Plugin } from "vite";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY, themes } from "../src/themes.ts";

// Only the tokens used by the loading/error shell are needed before React.
// Generate them from the theme catalog so existing saved selections work on
// their first visit after an upgrade, without maintaining a second palette.
const shellTokens = [
  "--bg-primary", "--text-primary", "--text-secondary", "--accent",
  "--border-default", "--text-on-accent",
];

export function themeBootstrapScript(): string {
  const palettes = Object.fromEntries(themes.map((theme) => [theme.id, {
    ...Object.fromEntries(shellTokens.map((token) => [token, theme.vars[token]])),
    "--font-sans": theme.fonts.sans,
    "--font-mono": theme.fonts.mono,
  }]));

  return `(() => {
    const palettes = ${JSON.stringify(palettes).replace(/</g, "\\u003c")};
    let id = ${JSON.stringify(DEFAULT_THEME_ID)};
    try {
      const saved = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
      if (Object.prototype.hasOwnProperty.call(palettes, saved)) id = saved;
    } catch {}
    const root = document.documentElement;
    for (const [key, value] of Object.entries(palettes[id])) root.style.setProperty(key, value);
    root.dataset.theme = id;
  })();`;
}

export function themeBootstrap(): Plugin {
  return {
    name: "theme-bootstrap",
    transformIndexHtml() {
      // A classic inline head script runs before the body can paint, even
      // while the entry module or its stylesheets are still downloading.
      return [{ tag: "script", children: themeBootstrapScript(), injectTo: "head" }];
    },
  };
}
