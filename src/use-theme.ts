import { createContext, useContext } from "react";
import type { ThemeDefinition } from "./themes.ts";
import { themes, themeMap, DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "./themes.ts";

// ── Context ───────────────────────────────────────────────

export interface ThemeContextValue {
  themeId: string;
  theme: ThemeDefinition;
  setTheme: (id: string) => void;
  themes: ThemeDefinition[];
}

export const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  theme: themes[0]!,
  setTheme: () => {},
  themes,
});

// ── Hook ──────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

// ── localStorage persistence ──────────────────────────────

export function loadPersistedThemeId(): string {
  try {
    const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
    return storedThemeId && Object.hasOwn(themeMap, storedThemeId) ? storedThemeId : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function persistThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // localStorage might be unavailable
  }
}
