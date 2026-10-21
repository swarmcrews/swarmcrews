import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import type { RepositoryPathRequest, RepositoryPathSuggestions } from "../../shared/repository-paths.ts";
import { RepositoryPathPicker } from "./RepositoryPathPicker.tsx";

const key = "swarmcrews:starred-project-folders";
const home: RepositoryPathSuggestions = {
  platform: "posix", separator: "/", roots: [{ name: "alex", path: "/home/alex" }],
  directory: "/home/alex", parent: null, breadcrumbs: [{ name: "alex", path: "/home/alex" }],
  entries: [{ name: "Projects", path: "/home/alex/Projects" }], truncated: false,
};
const projects: RepositoryPathSuggestions = {
  ...home, directory: "/home/alex/Projects", parent: "/home/alex",
  breadcrumbs: [...home.breadcrumbs, { name: "Projects", path: "/home/alex/Projects" }], entries: [],
};
function folders(handler: (request: RepositoryPathRequest) => RepositoryPathSuggestions | Response | Promise<RepositoryPathSuggestions | Response>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/token") return Response.json({ token: "test" });
    const result = await handler(JSON.parse(String(init?.body)));
    return result instanceof Response ? result : Response.json(result);
  }));
}
function Probe({ initial = "", defaultOpen = true }: { initial?: string; defaultOpen?: boolean }) {
  const [value, setValue] = useState(initial);
  return <RepositoryPathPicker value={value} onChange={setValue} defaultOpen={defaultOpen} />;
}
function locations() {
  fireEvent.click(screen.getByRole("button", { name: "Locations" }));
  return screen.getByRole("region", { name: "Folder locations" });
}
beforeEach(() => { localStorage.removeItem(key); clearAuthToken(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.removeItem(key); clearAuthToken(); });

describe("starred browsing locations", () => {
  it("stars multiple folders beside the breadcrumbs and restores them as shortcuts on the next visit", async () => {
    folders(request => request.path === projects.directory ? projects : home);
    const change = vi.fn();
    const first = render(<RepositoryPathPicker value="" onChange={change} />);
    const homeStar = await screen.findByRole("button", { name: "Star folder Home" });
    expect(homeStar.closest(".repository-path-picker__breadcrumb-bar")).not.toBeNull();
    fireEvent.click(homeStar);
    fireEvent.click(screen.getByRole("option", { name: "Projects" }));
    fireEvent.click(await screen.findByRole("button", { name: "Star folder Projects" }));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([home.directory, projects.directory]);
    expect(change).not.toHaveBeenCalled();
    first.unmount();
    render(<Probe />);
    await screen.findByRole("option", { name: "Projects" });
    expect(screen.queryByText(projects.directory!, { selector: ".repository-path-picker__value" })).not.toBeInTheDocument();
    const saved = within(locations());
    expect(saved.getAllByRole("button")[0]).toHaveAccessibleName("Home");
    expect(saved.getByRole("button", { name: `Open starred folder ${home.directory}` })).toBeVisible();
    expect(saved.getByRole("button", { name: `Open starred folder ${projects.directory}` })).toBeVisible();
  });

  it("opens a saved folder for browsing and still requires explicit confirmation", async () => {
    localStorage.setItem(key, JSON.stringify([projects.directory]));
    folders(request => request.path === projects.directory ? projects : home);
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    await screen.findByRole("option");
    fireEvent.click(within(locations()).getByRole("button", { name: `Open starred folder ${projects.directory}` }));
    const use = await screen.findByRole("button", { name: "Use folder Projects" });
    await waitFor(() => expect(use).toBeEnabled());
    expect(screen.queryByRole("region", { name: "Folder locations" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(use);
    expect(change).toHaveBeenCalledWith(projects.directory);
  });

  it("does not request or select saved folders when a returning user's chooser is closed", () => {
    localStorage.setItem(key, JSON.stringify([projects.directory]));
    const request = vi.fn(() => projects);
    folders(request);
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} defaultOpen={false} />);
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("can star an ancestor after navigating to its breadcrumb", async () => {
    folders(request => request.path === projects.directory ? projects : home);
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    fireEvent.click(await screen.findByRole("option", { name: "Projects" }));
    await screen.findByRole("button", { name: "Star folder Projects" });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Folder breadcrumbs" })).getByRole("button", { name: "Home" }));
    fireEvent.click(await screen.findByRole("button", { name: "Star folder Home" }));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([home.directory]);
    expect(change).not.toHaveBeenCalled();
  });

  it("unstar removes only that shortcut and leaves the current selection intact", async () => {
    localStorage.setItem(key, JSON.stringify([home.directory, projects.directory]));
    folders(() => projects);
    render(<Probe initial={projects.directory!} />);
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    await screen.findByRole("button", { name: "Unstar folder Projects" });
    fireEvent.click(within(locations()).getByRole("button", { name: `Unstar folder ${projects.directory}` }));
    expect(screen.getByRole("button", { name: "Locations" })).toHaveFocus();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([home.directory]);
    expect(screen.getByText(projects.directory!, { selector: ".repository-path-picker__value" })).toBeVisible();
    fireEvent.keyDown(screen.getByRole("button", { name: "Locations" }), { key: "Escape" });
    expect(screen.getByRole("button", { name: "Star folder Projects" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps unavailable shortcuts removable and never selects a substitute directory", async () => {
    localStorage.setItem(key, JSON.stringify(["/unavailable"]));
    folders(request => request.path === "/unavailable"
      ? Response.json({ error: "Folder is unavailable or outside configured browse roots" }, { status: 403 }) : home);
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    await screen.findByRole("option");
    fireEvent.click(within(locations()).getByRole("button", { name: "Open starred folder /unavailable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This folder cannot be browsed");
    expect(screen.getByRole("button", { name: "Use folder Home" })).toBeDisabled();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(within(locations()).getByRole("button", { name: "Unstar folder /unavailable" }));
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("provides configured roots and closes Locations with Escape without cancelling the chooser", async () => {
    const requests: RepositoryPathRequest[] = [];
    folders(request => { requests.push(request); return request.path === "" ? { ...home, directory: null, entries: [], breadcrumbs: [] } : home; });
    render(<Probe />);
    await screen.findByRole("option");
    const menu = locations();
    expect(within(menu).getByRole("button", { name: "Home" })).toHaveFocus();
    fireEvent.keyDown(within(menu).getByRole("button", { name: "Home" }), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Folder locations" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Locations" })).toHaveFocus();
    expect(screen.getByRole("combobox")).toBeVisible();
    fireEvent.click(within(locations()).getByRole("button", { name: "Browse configured locations" }));
    await screen.findByRole("option", { name: "Home" });
    expect(requests.at(-1)?.path).toBe("");
  });

  it("dismisses Locations on an outside pointer click without cancelling browsing", async () => {
    folders(() => home);
    render(<Probe />);
    await screen.findByRole("option");
    locations();
    fireEvent.pointerDown(screen.getByRole("combobox"));
    expect(screen.queryByRole("region", { name: "Folder locations" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeVisible();
  });

  it("reports failed persistence without claiming the star was saved or removed", async () => {
    folders(() => home);
    render(<Probe />);
    const star = await screen.findByRole("button", { name: "Star folder Home" });
    const storage = localStorage;
    vi.stubGlobal("localStorage", { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error("Storage blocked"); } });
    fireEvent.click(star);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save starred folders");
    expect(star).toHaveAttribute("aria-pressed", "false");
    vi.unstubAllGlobals();
    fireEvent.click(star);
    vi.stubGlobal("localStorage", { getItem: storage.getItem.bind(storage), removeItem: () => { throw new Error("Storage blocked"); } });
    fireEvent.click(screen.getByRole("button", { name: "Unstar folder Home" }));
    expect(screen.getByRole("button", { name: "Unstar folder Home" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["not JSON", "{}", '["", 42, "/home/alex/Projects", "/home/alex/Projects"]'])("handles malformed or duplicate preferences: %s", async raw => {
    localStorage.setItem(key, raw);
    folders(() => home);
    render(<Probe />);
    await screen.findByRole("option");
    const saved = within(locations());
    expect(saved.queryAllByRole("button", { name: /Open starred folder/ }).length).toBeLessThanOrEqual(1);
  });

  it("survives unavailable browser storage", async () => {
    folders(() => home);
    const read = vi.fn(() => { throw new Error("Storage blocked"); });
    vi.stubGlobal("localStorage", { getItem: read });
    render(<Probe />);
    expect(await screen.findByRole("button", { name: "Star folder Home" })).toBeEnabled();
    expect(read).toHaveBeenCalled();
  });

  it("retains Windows paths exactly when opening a starred location", async () => {
    const path = String.raw`C:\Work\Résumé project`;
    localStorage.setItem(key, JSON.stringify([path]));
    const requests: RepositoryPathRequest[] = [];
    folders(request => { requests.push(request); return request.path === path
      ? { ...projects, platform: "win32", separator: "\\", directory: path, breadcrumbs: [{ name: "Résumé project", path }] } : home; });
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    await screen.findByRole("option");
    fireEvent.click(within(locations()).getByRole("button", { name: `Open starred folder ${path}` }));
    const use = await screen.findByRole("button", { name: "Use folder Résumé project" });
    await waitFor(() => expect(use).toBeEnabled());
    expect(requests.at(-1)?.path).toBe(path);
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(use);
    expect(change).toHaveBeenCalledWith(path);
  });

  it("disables starring stale or disabled folders", async () => {
    folders(request => request.path === projects.directory ? new Promise(() => {}) : home);
    const view = render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    const star = await screen.findByRole("button", { name: "Star folder Home" });
    fireEvent.click(screen.getByRole("option", { name: "Projects" }));
    expect(star).toBeDisabled();
    view.rerender(<RepositoryPathPicker value="" onChange={vi.fn()} disabled />);
    expect(star).toBeDisabled();
    expect(localStorage.getItem(key)).toBeNull();
  });
});
