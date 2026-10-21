import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import type { RepositoryPathRequest, RepositoryPathSuggestions } from "../../shared/repository-paths.ts";
import { RepositoryPathPicker } from "./RepositoryPathPicker.tsx";

const home: RepositoryPathSuggestions = {
  platform: "posix", separator: "/", roots: [{ name: "alex", path: "/home/alex" }],
  directory: "/home/alex", parent: null, breadcrumbs: [{ name: "alex", path: "/home/alex" }],
  entries: [{ name: "Projects", path: "/home/alex/Projects" }], truncated: false,
};
const projects: RepositoryPathSuggestions = {
  ...home, directory: "/home/alex/Projects", parent: "/home/alex",
  breadcrumbs: [...home.breadcrumbs, { name: "Projects", path: "/home/alex/Projects" }],
  entries: [{ name: "Résumé project", path: "/home/alex/Projects/Résumé project" }],
};
const selected: RepositoryPathSuggestions = {
  ...projects, directory: "/home/alex/Projects/Résumé project", parent: "/home/alex/Projects",
  breadcrumbs: [...projects.breadcrumbs, { name: "Résumé project", path: "/home/alex/Projects/Résumé project" }], entries: [],
};

function folders(handler: (request: RepositoryPathRequest, signal: AbortSignal) => RepositoryPathSuggestions | Response | Promise<RepositoryPathSuggestions | Response>) {
  return vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/token") return Response.json({ token: "test" });
    const result = await handler(JSON.parse(String(init?.body)), init?.signal as AbortSignal);
    return result instanceof Response ? result : Response.json(result);
  }));
}
function Probe({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <RepositoryPathPicker value={value} onChange={setValue} />;
}
beforeEach(() => clearAuthToken());
afterEach(() => { vi.unstubAllGlobals(); clearAuthToken(); });

describe("folder-first repository picker", () => {
  it("preserves a browsed folder when project availability is refreshed", async () => {
    folders(request => request.path === projects.directory ? projects : home);
    const change = vi.fn();
    const view = render(<RepositoryPathPicker value="" onChange={change} defaultOpen />);
    fireEvent.click(await screen.findByRole("option", { name: "Projects" }));
    await screen.findByRole("option", { name: "Résumé project" });
    view.rerender(<RepositoryPathPicker value="" onChange={change} defaultOpen={false} />);
    view.rerender(<RepositoryPathPicker value="" onChange={change} defaultOpen />);
    expect(screen.getByRole("option", { name: "Résumé project" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Use folder Projects" })).toBeEnabled();
    expect(change).not.toHaveBeenCalled();
  });
  it("places the collapsed chooser actions below the header and hides them in either editor", async () => {
    folders(() => home);
    render(<Probe initial="/existing" />);
    const change = screen.getByRole("button", { name: "Change folder" });
    const manual = screen.getByRole("button", { name: "Enter a path instead" });
    expect(change.parentElement).toBe(manual.parentElement);
    expect(change.closest(".repository-path-picker__label-row")).toBeNull();
    expect(manual.closest(".repository-path-picker__label-row")).toBeNull();
    fireEvent.click(change);
    await screen.findByRole("option");
    expect(screen.queryByRole("button", { name: "Enter a path instead" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change folder" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    expect(screen.queryByRole("button", { name: "Enter a path instead" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change folder" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Change folder" })).toHaveFocus();
  });
  it("starts at Home with folder-name search and requires explicit path-entry opt-in", async () => {
    const requests: RepositoryPathRequest[] = [];
    folders(request => { requests.push(request); return home; });
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    expect(await screen.findByRole("option", { name: "Projects" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Search folders" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Repository path" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Folder breadcrumbs" })).toHaveTextContent("Home");
    expect(requests[0]).toMatchObject({ path: "~", mode: "browse" });
    expect(change).not.toHaveBeenCalled();
  });

  it("filters within the folder being browsed without changing the chosen path", async () => {
    const requests: RepositoryPathRequest[] = [];
    folders(request => {
      requests.push(request);
      if (request.path === "/home/alex/Projects") return projects;
      return home;
    });
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    fireEvent.click(await screen.findByRole("option", { name: "Projects" }));
    await screen.findByRole("option", { name: "Résumé project" });
    fireEvent.change(screen.getByRole("combobox", { name: "Search folders" }), { target: { value: "rés" } });
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ path: "/home/alex/Projects", mode: "browse", query: "rés" }));
    expect(change).not.toHaveBeenCalled();
  });

  it("explores then explicitly selects exactly the current folder", async () => {
    folders(request => request.path === selected.directory ? selected : request.path === projects.directory ? projects : home);
    render(<Probe />);
    fireEvent.click(await screen.findByRole("option", { name: "Projects" }));
    fireEvent.click(await screen.findByRole("option", { name: "Résumé project" }));
    const use = await screen.findByRole("button", { name: "Use folder Résumé project" });
    await waitFor(() => expect(use).toBeEnabled());
    expect(use.closest(".repository-path-picker__breadcrumb-bar")).not.toBeNull();
    expect(use.closest(".repository-path-picker__footer")).toBeNull();
    fireEvent.click(use);
    expect(screen.getByText(selected.directory!)).toHaveClass("repository-path-picker__value");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change folder" })).toHaveFocus();
  });

  it("cancel and Escape retain the previously confirmed folder", async () => {
    folders(() => projects);
    render(<Probe initial="/home/alex/existing" />);
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    await screen.findByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.getByText("/home/alex/existing")).toHaveClass("repository-path-picker__value");
    expect(screen.getByRole("button", { name: "Change folder" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/mistake" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("/home/alex/existing")).toBeVisible();
  });

  it("keeps a manual draft separate until Use this path, including new or unbrowseable paths", async () => {
    folders(() => home);
    const change = vi.fn();
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><RepositoryPathPicker value="" onChange={change} defaultOpen={false} /><button>Open project</button></form>);
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    const path = screen.getByRole("textbox", { name: "Repository path" });
    fireEvent.change(path, { target: { value: "  /mnt/new-project  " } });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use this path" })).toBeEnabled();
    fireEvent.keyDown(path, { key: "Enter" });
    expect(change).toHaveBeenCalledWith("/mnt/new-project");
    expect(submit).not.toHaveBeenCalled();
  });

  it("navigates and goes up from the search field without implicit selection or submission", async () => {
    folders(request => request.path === projects.directory ? projects : home);
    const change = vi.fn();
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><RepositoryPathPicker value="" onChange={change} /></form>);
    await screen.findByRole("option");
    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("option", { name: "Résumé project" });
    fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
    await screen.findByRole("option", { name: "Projects" });
    expect(change).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
    expect(screen.getByRole("region", { name: "Choose a project folder" })).toBeVisible();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(change).toHaveBeenCalledWith(home.directory);
  });

  it("ignores stale responses during filtering and after cancellation", async () => {
    let finish!: (result: RepositoryPathSuggestions) => void;
    let oldSignal!: AbortSignal;
    folders((request, signal) => {
      if (request.query === "old") { oldSignal = signal; return new Promise(resolve => { finish = resolve; }); }
      return home;
    });
    render(<Probe />);
    await screen.findByRole("option");
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "old" } });
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.change(input, { target: { value: "new" } });
    expect(oldSignal.aborted).toBe(true);
    fireEvent.keyDown(input, { key: "Escape" });
    await act(async () => finish(projects));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.queryByText(projects.directory!)).not.toBeInTheDocument();
  });

  it("falls back to configured locations when Home is outside browsing roots", async () => {
    folders(request => request.path === "~"
      ? Response.json({ error: "Folder is unavailable or outside configured browse roots" }, { status: 403 })
      : { ...home, directory: null, parent: null, breadcrumbs: [], entries: [] });
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    expect(await screen.findByRole("option", { name: "alex" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Use folder/ })).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  it("retains Windows paths exactly and never interprets a folder-name query as a path", async () => {
    folders(() => ({ ...home, platform: "win32", separator: "\\", directory: "C:\\work\\demo", roots: [], breadcrumbs: [{ name: "demo", path: "C:\\work\\demo" }], entries: [] }));
    const change = vi.fn();
    render(<RepositoryPathPicker value={"C:\\work\\demo"} onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use folder demo" }));
    expect(change).toHaveBeenCalledWith("C:\\work\\demo");
  });
});
