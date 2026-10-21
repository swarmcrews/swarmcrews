import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const destination = { name: "Fresh app", path: "/home/alex/Fresh app" };
function folders(handler: (request: RepositoryPathRequest) => RepositoryPathSuggestions | Response | Promise<RepositoryPathSuggestions | Response>) {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (url === "/api/auth/token") return Response.json({ token: "test" });
    const result = await handler(JSON.parse(String(init?.body)));
    return result instanceof Response ? result : Response.json(result);
  }));
  return requests;
}
function Probe() {
  const [value, setValue] = useState("/existing");
  return <RepositoryPathPicker value={value} onChange={setValue} />;
}
beforeEach(() => clearAuthToken());
afterEach(() => { vi.unstubAllGlobals(); clearAuthToken(); });

describe("new folder from an empty search", () => {
  it("selects the server-checked destination explicitly without creating or checking a project", async () => {
    const requests = folders(request => request.query ? { ...home, entries: [], newDirectory: destination } : home);
    const change = vi.fn();
    const newFolder = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} onNewFolder={newFolder} />);
    await screen.findByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: destination.name } });
    const use = await screen.findByRole("button", { name: "Use new folder Fresh app" });
    expect(screen.getByText(destination.path)).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    expect(newFolder).not.toHaveBeenCalled();
    fireEvent.click(use);
    expect(change).toHaveBeenCalledWith(destination.path);
    expect(newFolder).toHaveBeenCalledOnce();
    expect(requests.every(url => url === "/api/auth/token" || url === "/api/projects/path-suggestions")).toBe(true);
    expect(screen.getByRole("button", { name: "Choose folder" })).toHaveFocus();
  });

  it("uses Ctrl+Enter for the new destination and never implicitly submits on Enter", async () => {
    folders(request => request.query ? { ...home, entries: [], newDirectory: destination } : home);
    const change = vi.fn();
    const submit = vi.fn(event => event.preventDefault());
    render(<form onSubmit={submit}><RepositoryPathPicker value="" onChange={change} /></form>);
    await screen.findByRole("option");
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: destination.name } });
    await screen.findByRole("button", { name: "Use new folder Fresh app" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(change).toHaveBeenCalledWith(destination.path);
    expect(submit).not.toHaveBeenCalled();
  });

  it("preserves the old selection on cancellation", async () => {
    folders(request => request.query ? { ...home, entries: [], newDirectory: destination } : home);
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    await screen.findByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: destination.name } });
    await screen.findByRole("button", { name: "Use new folder Fresh app" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.getByText("/existing")).toHaveClass("repository-path-picker__value");
    expect(screen.queryByText(destination.path)).not.toBeInTheDocument();
  });

  it("hides the previous proposal while a new lookup is pending or fails", async () => {
    folders(request => request.query === "denied"
      ? Response.json({ error: "Folder is unavailable or outside configured browse roots" }, { status: 403 })
      : request.query ? { ...home, entries: [], newDirectory: destination } : home);
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    await screen.findByRole("option");
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: destination.name } });
    await screen.findByRole("button", { name: "Use new folder Fresh app" });
    fireEvent.change(input, { target: { value: "denied" } });
    expect(screen.queryByRole("button", { name: /Use new folder/ })).not.toBeInTheDocument();
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: /Use new folder/ })).not.toBeInTheDocument();
  });

  it.each(["no candidate", "matching folders"])("never guesses a destination for %s", async state => {
    folders(request => request.query ? {
      ...home, entries: state === "matching folders" ? home.entries : [],
      ...(state !== "no candidate" ? { newDirectory: destination } : {}),
    } : home);
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    await screen.findByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: destination.name } });
    await waitFor(() => expect(screen.queryByText("Loading folders…")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Use new folder/ })).not.toBeInTheDocument();
  });

  it("accepts a checked destination despite a partial listing and reopens its existing parent", async () => {
    const paths: string[] = [];
    folders(request => { paths.push(request.path!); return request.query ? { ...home, entries: [], truncated: true, newDirectory: destination } : home; });
    render(<Probe />);
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    await screen.findByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: destination.name } });
    fireEvent.click(await screen.findByRole("button", { name: "Use new folder Fresh app" }));
    expect(screen.getByText(destination.path)).toHaveClass("repository-path-picker__value");
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    await screen.findByRole("option");
    expect(paths.at(-1)).toBe(home.directory);
  });

  it("preserves a Windows destination supplied by the server and respects disabled state", async () => {
    const path = String.raw`C:\Work\Résumé app`;
    folders(request => request.query ? { ...home, platform: "win32", separator: "\\", entries: [], newDirectory: { name: "Résumé app", path } } : home);
    const change = vi.fn();
    const view = render(<RepositoryPathPicker value="" onChange={change} />);
    await screen.findByRole("option");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Résumé app" } });
    const use = await screen.findByRole("button", { name: "Use new folder Résumé app" });
    view.rerender(<RepositoryPathPicker value="" onChange={change} disabled />);
    expect(use).toBeDisabled();
    fireEvent.click(use);
    expect(change).not.toHaveBeenCalled();
    view.rerender(<RepositoryPathPicker value="" onChange={change} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Use new folder Résumé app" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Use new folder Résumé app" }));
    expect(change).toHaveBeenCalledWith(path);
  });
});
