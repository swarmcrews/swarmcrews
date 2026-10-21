import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MobileThemeProvider } from "./MobileThemeProvider.tsx";
import { useTheme } from "../use-theme.ts";

function ThemeControl() {
  const { themeId, setTheme } = useTheme();
  return <><output aria-label="Theme">{themeId}</output><button onClick={() => setTheme("daybook")}>Light theme</button></>;
}
const root = document.documentElement;
const previousStyle = root.getAttribute("style");
const previousTheme = root.getAttribute("data-theme");
const previousSaved = localStorage.getItem("canvas-theme");
afterEach(() => {
  if (previousStyle === null) root.removeAttribute("style"); else root.setAttribute("style", previousStyle);
  if (previousTheme === null) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", previousTheme);
  if (previousSaved === null) localStorage.removeItem("canvas-theme"); else localStorage.setItem("canvas-theme", previousSaved);
});

describe("standalone mobile theme editing", () => {
  it("applies changes immediately, persists them and restores the selected theme", () => {
    localStorage.setItem("canvas-theme", "midnight");
    const first = render(<MobileThemeProvider><ThemeControl /></MobileThemeProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    expect(screen.getByLabelText("Theme")).toHaveTextContent("daybook");
    expect(root).toHaveAttribute("data-theme", "daybook");
    expect(localStorage.getItem("canvas-theme")).toBe("daybook");
    first.unmount();
    render(<MobileThemeProvider><ThemeControl /></MobileThemeProvider>);
    expect(screen.getByLabelText("Theme")).toHaveTextContent("daybook");
  });
});
