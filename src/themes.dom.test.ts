import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, themes, skinThemes } from "./themes.ts";

afterEach(() => applyTheme("midnight"));

describe("native control theme paint", () => {
  it.each([...themes, ...skinThemes])("uses $tone control paint for $name", theme => {
    applyTheme(theme.id);
    expect(document.documentElement.style.colorScheme).toBe(theme.tone);
  });

  it("updates native controls when switching dark/light without changing accent identity", () => {
    const light = themes.find(theme => theme.tone === "light")!;
    applyTheme(light.id);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(light.vars["--accent"]);
    applyTheme("midnight");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
