import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { applyTheme, DEFAULT_THEME_ID, themeMap, themes } from "../themes.ts";
import { loadPersistedThemeId, persistThemeId, ThemeContext } from "../use-theme.ts";

/** The standalone /m route owns the same persistent theme context as desktop. */
export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState(loadPersistedThemeId);
  useLayoutEffect(() => { applyTheme(themeId); }, [themeId]);
  const setTheme = useCallback((id: string) => {
    if (!Object.hasOwn(themeMap, id)) return;
    setThemeId(id);
    persistThemeId(id);
    applyTheme(id);
  }, []);
  const value = useMemo(() => ({ themeId, theme: themeMap[themeId] ?? themeMap[DEFAULT_THEME_ID]!, setTheme, themes }), [themeId, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
