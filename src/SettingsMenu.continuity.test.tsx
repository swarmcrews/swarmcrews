import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { updateProjectSettings, type ProjectSettings } from "./api.ts";
import { hasNavigationDraft } from "./navigation-drafts.tsx";
import type { SettingsSaveState } from "./ContextActionsSettings.tsx";

function Harness() {
  const [settings, setSettings] = useState<ProjectSettings>({});
  const [saveState, setSaveState] = useState<SettingsSaveState>({ status: "idle" });
  const save = (next: ProjectSettings) => {
    setSettings(next); setSaveState({ status: "saving" });
    void updateProjectSettings("project", next).then(() => setSaveState({ status: "saved" }))
      .catch(() => setSaveState({ status: "error", error: "offline" }));
  };
  return <><button>Outside action</button><SettingsMenu settings={settings} onSettingsChange={save}
    settingsSaveState={saveState} onRetrySettingsSave={() => save(settings)} /></>;
}
function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  fireEvent.click(screen.getByRole("button", { name: /^Context actions/ }));
}
function leave(route: string) {
  if (route === "category") fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  else if (route === "escape") fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
  else if (route === "outside") fireEvent.mouseDown(screen.getByRole("button", { name: "Outside action" }));
  else fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each(["category", "escape", "outside", "trigger"])("retains desktop recipe input across %s until explicit Cancel", route => {
  const fetch = vi.fn(async () => Response.json({})); vi.stubGlobal("fetch", fetch);
  render(<Harness />); openEditor(); const original = (screen.getByLabelText("Name") as HTMLInputElement).value;
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Important desktop recipe draft" } });
  fireEvent.click(screen.getByRole("button", { name: /^Context actions/ }));
  expect(screen.queryByRole("dialog", { name: "Keep your unsaved work" })).toBeNull();
  leave(route);
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Important desktop recipe draft");
  expect(hasNavigationDraft(document)).toBe(true); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Name")).toHaveValue(original); expect(hasNavigationDraft(document)).toBe(false);
  leave(route); expect(screen.queryByRole("dialog", { name: "Keep your unsaved work" })).toBeNull();
  expect(screen.queryByLabelText("Name")).toBeNull();
});
it("keeps pending/failed settings visible until retry, then allows clean category/keyboard departure", async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi.fn((url: unknown, _init?: RequestInit) => String(url).endsWith("/auth/token")
    ? Promise.resolve(Response.json({ token: "test" })) : new Promise<Response>(r => { resolve = r; })); vi.stubGlobal("fetch", fetch);
  render(<Harness />); openEditor();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saved desktop recipe" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function")); leave("category");
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => resolve(Response.json({ error: "offline" }, { status: 503 })));
  await screen.findByText("Save failed"); leave("escape");
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Saved desktop recipe");
  fetch.mockImplementationOnce(async () => Response.json({})); fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Saved"); expect(hasNavigationDraft(document)).toBe(false);
  leave("category"); expect(screen.getByRole("heading", { name: "Workspace" })).toBeVisible();
  const category = screen.getByRole("button", { name: /^Workspace/ }); category.focus();
  fireEvent.keyDown(category, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open settings" })).toHaveFocus();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(2);
});
it("exposes retry for failed non-recipe settings while dismissal is blocked", async () => {
  const fetch = vi.fn(async (url: unknown) => String(url).endsWith("/auth/token")
    ? Response.json({ token: "test" }) : Response.json({ error: "offline" }, { status: 503 })); vi.stubGlobal("fetch", fetch);
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  fireEvent.click(screen.getByRole("button", { name: /^Workspace/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Tidy layout/ }));
  const retry = await screen.findByRole("button", { name: "Retry settings save" });
  fireEvent.keyDown(screen.getByRole("button", { name: /^Workspace/ }), { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fetch.mockImplementationOnce(async () => Response.json({})); fireEvent.click(retry);
  await waitFor(() => expect(hasNavigationDraft(document)).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Open settings" })); expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
});
