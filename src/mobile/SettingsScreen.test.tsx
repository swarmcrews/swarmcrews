import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./SettingsScreen.tsx";
import type { ProjectSettings } from "../api.ts";

const project = { id: "proj", name: "Project", path: "/work/app" };
function setup(settings: ProjectSettings = {}) {
  const writes: ProjectSettings[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("/settings")) {
      if (init?.method === "PUT") { writes.push(JSON.parse(String(init.body))); return Response.json({}); }
      return Response.json(settings);
    }
    if (String(url).endsWith("/skills")) return Response.json([]);
    if (String(url).endsWith("/mcp-servers")) return Response.json({ entries: [], statuses: {}, invalid: [] });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, writes };
}
async function openCategory(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${name}`) }));
  return screen.findByRole("heading", { name, level: 1 });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("mobile settings", () => {
  it("offers the same six desktop categories and separate server administration", async () => {
    setup(); render(<SettingsScreen project={project} />);
    const navigation = await screen.findByRole("navigation", { name: "Settings categories" });
    expect(within(navigation).getAllByRole("button").map(button => button.querySelector("strong")?.textContent))
      .toEqual(["General", "Agent defaults", "Workspace", "Connections", "Context actions", "Governance", "Server"]);
    expect(within(navigation).getAllByText("Beta")).toHaveLength(1);
    expect(within(navigation).getByText("Beta").closest("button")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await openCategory("General");
    expect(screen.getByRole("button", { name: /^Daybook/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All settings" }));
    expect(screen.getByRole("button", { name: /^General/ })).toHaveFocus();
  });

  it("edits workspace options without losing existing desktop settings", async () => {
    const { writes } = setup({ defaultLeaderModel: "claude-opus-4-8", systemModel: "advisory" });
    render(<SettingsScreen project={project} />);
    await openCategory("Workspace");
    fireEvent.click(screen.getByRole("checkbox", { name: /Isolate new Leader work/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ defaultLeaderModel: "claude-opus-4-8", systemModel: "advisory", defaultWorktreeIsolation: false });
    expect(screen.getByRole("checkbox", { name: /Tidy layout/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Snap while dragging/ })).toBeChecked();
  });

  it("provides Leader, Minion, sandbox, permissions and adaptive roles", async () => {
    const { writes } = setup(); render(<SettingsScreen project={project} />);
    await openCategory("Agent defaults");
    expect(screen.getByRole("region", { name: "Leader defaults" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Minion defaults" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sandbox file access")).toBeInTheDocument();
    expect(screen.getByText("Default permission mode")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Adaptive tier routing/ }));
    await screen.findByRole("tablist", { name: "Minion assignment tiers" });
    fireEvent.click(screen.getByRole("checkbox", { name: /adaptive expert roles/i }));
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ roleSystemBeta: true, adaptiveMinionModelRouting: true }));
  });

  it("edits governance and context action recipes and opens project connections", async () => {
    const { writes } = setup(); render(<SettingsScreen project={project} />);
    await openCategory("Governance");
    fireEvent.click(screen.getByRole("radio", { name: /Enforced/ }));
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ systemModel: "enforced" }));
    fireEvent.click(screen.getByRole("button", { name: "All settings" }));
    await openCategory("Context actions");
    expect(await screen.findByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create action" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All settings" }));
    await openCategory("Connections");
    expect(await screen.findByRole("button", { name: "Add connection" })).toBeInTheDocument();
  });

  it("recovers from a failed load", async () => {
    const { fetch } = setup(); fetch.mockRejectedValueOnce(new Error("Offline"));
    render(<SettingsScreen project={project} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline");
    expect(screen.queryByRole("navigation", { name: "Settings categories" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading settings" }));
    expect(await screen.findByRole("navigation", { name: "Settings categories" })).toBeInTheDocument();
  });

  it("retries the latest failed save instead of discarding the change", async () => {
    const { fetch, writes } = setup(); render(<SettingsScreen project={project} />);
    await openCategory("Workspace");
    fetch.mockRejectedValueOnce(new Error("Cannot save"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Tidy layout/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save");
    expect(screen.getByRole("checkbox", { name: /Tidy layout/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Retry saving settings" }));
    await waitFor(() => expect(writes.at(-1)).toMatchObject({ tidyLayout: false }));
    await screen.findByText("Saved");
  });

  it("serializes rapid changes so an older write cannot overwrite a newer one", async () => {
    const { fetch, writes } = setup(); render(<SettingsScreen project={project} />);
    await openCategory("Workspace");
    let resolveFirst!: (response: Response) => void;
    fetch.mockImplementationOnce(async (_url, init) => {
      writes.push(JSON.parse(String(init?.body)));
      return new Promise<Response>(resolve => { resolveFirst = resolve; });
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tidy layout/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.click(screen.getByRole("checkbox", { name: /Snap while dragging/ }));
    expect(writes).toHaveLength(1);
    await act(async () => resolveFirst(Response.json({})));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ tidyLayout: false, snapWhileDragging: false });
  });

  it("requires explicit confirmation before restarting the server", async () => {
    const { fetch } = setup(); render(<SettingsScreen project={project} />);
    await openCategory("Server");
    fireEvent.click(screen.getByRole("button", { name: "Restart Server" }));
    const dialog = screen.getByRole("dialog", { name: "Restart Swarmcrews server" });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/server/restart"))).toBe(false);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restart Server" }));
    await screen.findByText(/Restart requested/);
    expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith("/server/restart") && init?.method === "POST")).toBe(true);
  });
});

it.each(["Name", "Prompt"])("protects local category navigation with unsaved %s edits", async field => {
  setup({ dashboardLeaderActions: [{ id: "saved", name: "Saved action", prompt: "Persisted prompt", icon: "zap", skillIds: [] }] });
  render(<SettingsScreen project={project} />); await openCategory("Context actions");
  fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
  await openCategory("Context actions");
  fireEvent.change(await screen.findByLabelText(field), { target: { value: field === "Name" ? "Unsaved action" : "" } });
  expect(document.querySelector('[data-navigation-scope="context-actions"]')).toHaveAttribute("data-navigation-state", "dirty");
  fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText(field)).toHaveValue(field === "Name" ? "Unsaved action" : "");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
});
it("keeps the current category while settings save is pending or failed, then permits return after retry", async () => {
  const { fetch } = setup(); render(<SettingsScreen project={project} />); await openCategory("Workspace");
  let resolve!: (response: Response) => void;
  fetch.mockImplementationOnce(async () => new Promise<Response>(r => { resolve = r; }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Tidy layout/ }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => resolve(Response.json({ error: "offline" }, { status: 503 })));
  await screen.findByText("Not saved"); fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry saving settings" })); await screen.findByText("Saved");
  fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
});

const twoRecipes: ProjectSettings = { dashboardLeaderActions: [
  { id: "first", name: "First recipe", prompt: "First prompt", icon: "zap", skillIds: [] },
  { id: "second", name: "Second recipe", prompt: "Second prompt", icon: "zap", skillIds: [] },
] };
it.each(["select", "create", "remove", "restore"])("protects dirty recipe input before internal %s transition", async transition => {
  const { writes } = setup(twoRecipes); render(<SettingsScreen project={project} />); await openCategory("Context actions");
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Important unsaved recipe" } });
  // Selecting the already selected saved row must not reset its local draft.
  fireEvent.click(screen.getByRole("option", { name: /First recipe/ }));
  expect(screen.getByLabelText("Name")).toHaveValue("Important unsaved recipe");
  const request = () => fireEvent.click(transition === "select" ? screen.getByRole("option", { name: /Second recipe/ })
    : screen.getByRole("button", { name: transition === "create" ? "Create action" : transition === "remove" ? "Remove First recipe" : "Restore defaults" }));
  request(); expect(screen.getByLabelText("Name")).toHaveValue("Important unsaved recipe");
  expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  request(); fireEvent.click(screen.getByRole("button", { name: "Discard edits and continue" }));
  expect(screen.getByLabelText("Name")).not.toHaveValue("Important unsaved recipe");
  if (transition === "select") expect(screen.getByLabelText("Name")).toHaveValue("Second recipe");
  if (transition === "create") expect(screen.getByLabelText("Name")).toHaveValue("");
  if (transition === "remove" || transition === "restore") await waitFor(() => expect(writes).toHaveLength(1));
  else expect(writes).toHaveLength(0);
});
it("allows saved recipe selection but prevents internal transitions during pending/failed save", async () => {
  const { fetch } = setup(twoRecipes); render(<SettingsScreen project={project} />); await openCategory("Context actions");
  fireEvent.click(await screen.findByRole("option", { name: /Second recipe/ }));
  expect(screen.getByLabelText("Name")).toHaveValue("Second recipe");
  expect(screen.queryByRole("button", { name: "Discard edits and continue" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Saved second" } });
  let resolve!: (response: Response) => void;
  fetch.mockImplementationOnce(async () => new Promise<Response>(r => { resolve = r; }));
  fireEvent.click(screen.getByRole("button", { name: "Apply" })); await waitFor(() => expect(resolve).toBeTypeOf("function"));
  const blockedControls = () => [screen.getByRole("option", { name: /First recipe/ }), screen.getByRole("button", { name: "Create action" }), screen.getByRole("button", { name: "Restore defaults" }), screen.getByRole("button", { name: "Remove Saved second" })];
  blockedControls().forEach(control => expect(control).toBeDisabled());
  await act(async () => resolve(Response.json({ error: "offline" }, { status: 503 })));
  await screen.findByText("Not saved"); blockedControls().forEach(control => expect(control).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Retry saving settings" })); await screen.findByText("Saved", { selector: ".mob-settings-save" });
  fireEvent.click(screen.getByRole("option", { name: /First recipe/ })); expect(screen.getByLabelText("Name")).toHaveValue("First recipe");
});
it("owns new recipe icon-only edits and retains them when a saved recipe is requested", async () => {
  const { writes } = setup(twoRecipes); render(<SettingsScreen project={project} />); await openCategory("Context actions");
  await screen.findByLabelText("Name"); fireEvent.click(screen.getByRole("button", { name: "Create action" }));
  const icon = screen.getAllByRole("radio").find(item => item.getAttribute("aria-checked") === "false")!;
  fireEvent.click(icon); fireEvent.click(screen.getByRole("option", { name: /Second recipe/ }));
  expect(screen.getByLabelText("Name")).toHaveValue(""); expect(icon).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "All settings" })); expect(screen.getByRole("dialog", { name: "Keep your unsaved work" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" })); fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Name")).toHaveValue("First recipe"); expect(writes).toHaveLength(0);
});
it.each(["restore", "apply"])("clears default recipe ownership after successful %s without a redundant write or Cancel", async action => {
  const { writes } = setup(action === "restore" ? twoRecipes : {}); render(<SettingsScreen project={project} />); await openCategory("Context actions");
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Changed recipe name" } });
  if (action === "restore") {
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard edits and continue" }));
  } else fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText("Saved", { selector: ".mob-settings-save" });
  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  expect(writes).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "All settings" }));
  expect(screen.queryByRole("dialog", { name: "Keep your unsaved work" })).toBeNull();
  expect(screen.getByRole("navigation", { name: "Settings categories" })).toBeVisible();
});
