import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { RepositoryPathPicker } from "./RepositoryPathPicker.tsx";

const locations = {
  platform: "posix", separator: "/", roots: [{ name: "alex", path: "/home/alex" }],
  directory: null, parent: null, breadcrumbs: [], entries: [], truncated: false,
};
function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(
    url === "/api/auth/token" ? { token: "test-token" } : body,
    { status: url === "/api/auth/token" ? 200 : status },
  )));
}
beforeEach(() => clearAuthToken());
afterEach(() => { vi.unstubAllGlobals(); clearAuthToken(); });

describe("folder browser server feedback", () => {
  it("recovers from a malformed successful response without losing manual entry", async () => {
    respond({});
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load folders");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Enter a path instead" })).toBeEnabled();
  });
  it("requires exploring a permitted location before it can be confirmed", async () => {
    respond(locations);
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    const option = await screen.findByRole("option", { name: "alex" });
    expect(screen.queryByRole("button", { name: /Use folder/ })).not.toBeInTheDocument();
    respond({ ...locations, directory: "/home/alex", breadcrumbs: [{ name: "alex", path: "/home/alex" }] });
    fireEvent.click(option);
    fireEvent.click(await screen.findByRole("button", { name: "Use folder alex" }));
    expect(change).toHaveBeenCalledWith("/home/alex");
  });

  it("explains scope failures and permits an explicit manual path without waiting for discovery", async () => {
    respond({ error: "Folder is unavailable or outside configured browse roots" }, 403);
    const change = vi.fn();
    render(<RepositoryPathPicker value="/mnt/work" onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This folder cannot be browsed");
    expect(alert).not.toHaveTextContent("API error");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter a path instead" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), { target: { value: "/mnt/work/repo" } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use this path" }));
    expect(change).toHaveBeenCalledWith("/mnt/work/repo");
  });

  it("provides manual fallback when browsing is disabled or configured locations are invalid", async () => {
    respond({ ...locations, roots: [] });
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    expect(await screen.findByText(/No browsing locations are available/)).toHaveTextContent("enter a path directly");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Enter a path instead" })).toBeEnabled();
  });

  it("explains rejected host access without exposing an API error envelope", async () => {
    respond({ error: "Untrusted origin or host" }, 403);
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("localhost or the server’s Tailscale address");
    expect(screen.getByRole("alert")).not.toHaveTextContent("API error");
  });

  it("does not expose proxy HTML as folder feedback", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/auth/token"
      ? Response.json({ token: "test" }) : new Response("<html>Internal proxy detail</html>", { status: 502 })));
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load folders from the server");
    expect(alert).not.toHaveTextContent("Internal proxy detail");
  });

  it("preserves the chosen folder and supports retry after a timeout", async () => {
    respond({ error: "Folder lookup timed out; try another location" }, 503);
    render(<RepositoryPathPicker value="/mnt/work" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Change folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Folder lookup timed out");
    respond(locations);
    fireEvent.click(screen.getByRole("button", { name: "Retry folders" }));
    expect(await screen.findByRole("option", { name: "alex" })).toBeVisible();
    expect(screen.getByText("/mnt/work")).toBeVisible();
  });
});
