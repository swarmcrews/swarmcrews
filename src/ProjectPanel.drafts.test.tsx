import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectPanel } from "./ProjectPanel.tsx";
import { clearAuthToken } from "./api.ts";
import { hasNavigationDraft, openNavigationDraft } from "./navigation-drafts.tsx";

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
afterEach(() => { clearAuthToken(); vi.unstubAllGlobals(); });

it.each(["collapsed", "dashboard"])("Open draft reveals Context from %s without losing failed edits", async destination => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/token") return json({ token: "test" });
    if (url.endsWith("/context")) return options?.method === "PUT"
      ? new Response("save unavailable", { status: 500 })
      : json({ content: "Saved context", exists: true });
    if (url.includes("/tree?")) return json({ root: "Alpha", tree: [] });
    throw new Error(`Unexpected request: ${url}`);
  }));
  render(<ProjectPanel projectId="alpha" projectPath="/work/alpha" projectName="Alpha" nodes={[]} onSpawnContextExplorer={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
  fireEvent.click(screen.getByRole("button", { name: "context" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByLabelText("Workspace context"), { target: { value: "Retained context draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "dashboard" }));
  if (destination === "collapsed") fireEvent.click(screen.getByRole("button", { name: "✕" }));
  expect(screen.queryByLabelText("Workspace context")).not.toBeInTheDocument();
  expect(hasNavigationDraft(document)).toBe(true);
  openNavigationDraft();
  await waitFor(() => expect(screen.getByLabelText("Workspace context")).toBeVisible());
  expect(screen.getByRole("button", { name: "context" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Workspace context")).toHaveValue("Retained context draft");
  expect(screen.getByRole("alert")).toHaveTextContent("Context could not be saved");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});
