import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { themeBootstrapScript } from "../build/theme-bootstrap.ts";
import { applyTheme, DEFAULT_THEME_ID, THEME_STORAGE_KEY, themes } from "./themes.ts";
import { loadPersistedThemeId } from "./use-theme.ts";

function boot() {
  // Execute exactly the classic script injected into the HTML, before App.
  new Function(themeBootstrapScript())();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset["theme"];
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset["theme"];
});

describe("theme before the app loads", () => {
  it.each(themes)("restores $id without changing shell tokens when App mounts", (theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
    boot();

    const root = document.documentElement;
    expect(root.dataset["theme"]).toBe(theme.id);
    expect(root.style.getPropertyValue("--bg-primary")).toBe(theme.vars["--bg-primary"]);
    expect(root.style.getPropertyValue("--text-primary")).toBe(theme.vars["--text-primary"]);
    expect(root.style.getPropertyValue("--text-secondary")).toBe(theme.vars["--text-secondary"]);
    expect(root.style.getPropertyValue("--font-sans")).toBe(theme.fonts.sans);

    const initialTokens = Array.from(root.style).map((key) => [key, root.style.getPropertyValue(key)]);
    applyTheme(loadPersistedThemeId());
    for (const [key, value] of initialTokens) {
      expect(root.style.getPropertyValue(key!)).toBe(value);
    }
  });

  it.each([null, "glass", "unknown", "__proto__", "constructor"])("defaults safely for saved value %s", (id) => {
    if (id !== null) localStorage.setItem(THEME_STORAGE_KEY, id);
    boot();
    expect(document.documentElement.dataset["theme"]).toBe(DEFAULT_THEME_ID);
    expect(loadPersistedThemeId()).toBe(DEFAULT_THEME_ID);
  });

  it("uses the default when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    boot();
    expect(document.documentElement.dataset["theme"]).toBe(DEFAULT_THEME_ID);
  });
});
