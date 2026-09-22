import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { RepositoryPathPicker } from "./RepositoryPathPicker.tsx";

const suggestions = {
  platform: "posix", separator: "/",
  roots: [{ name: "alex", path: "/home/alex" }],
  directory: null, parent: null, breadcrumbs: [],
  entries: [{ name: "alex", path: "/home/alex" }], truncated: false,
};

function respond(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
    JSON.stringify(url === "/api/auth/token" ? { token: "test-token" } : body),
    { status: url === "/api/auth/token" ? 200 : status, headers: { "content-type": "application/json" } },
  )));
}

beforeEach(() => clearAuthToken());
afterEach(() => { vi.unstubAllGlobals(); clearAuthToken(); });

describe("RepositoryPathPicker server feedback", () => {
  it("selects an allowed root suggested for /home without making /home selectable", async () => {
    respond(suggestions);
    const onChange = vi.fn();
    render(<RepositoryPathPicker value="/home" onChange={onChange} />);
    fireEvent.focus(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: /alex/ });
    expect(screen.queryByRole("button", { name: "Use this folder" })).not.toBeInTheDocument();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("/home/alex");
  });

  it("explains scope errors without rendering raw HTTP or JSON and allows recovery", async () => {
    respond({ error: "Folder is unavailable or outside configured browse roots" }, 403);
    const onChange = vi.fn();
    render(<RepositoryPathPicker value="/mnt/work" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("SWARMCREWS_BROWSE_ROOTS");
    expect(alert).not.toHaveTextContent("API error");
    expect(alert).not.toHaveTextContent('{"error"');
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "/mnt/work/repo" } });
    expect(onChange).toHaveBeenCalledWith("/mnt/work/repo");
    respond({ ...suggestions, entries: [] });
    fireEvent.click(screen.getByRole("button", { name: "Browse locations" }));
    expect(await screen.findByRole("button", { name: "/home/alex" })).toBeInTheDocument();
  });

  it("explains disabled or invalid browsing configuration", async () => {
    respond({ ...suggestions, roots: [], entries: [] });
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(await screen.findByText(/No browsing locations are available/)).toHaveTextContent("SWARMCREWS_BROWSE_ROOTS");
    expect(screen.queryByText("No matching folders.")).not.toBeInTheDocument();
  });

  it("describes rejected host access without blaming the client machine", async () => {
    respond({ error: "Untrusted origin or host" }, 403);
    render(<RepositoryPathPicker value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("localhost or the server’s Tailscale address"));
    expect(screen.queryByText(/untrusted machine/)).not.toBeInTheDocument();
  });

  it("does not display a proxy HTML error as folder feedback", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/auth/token"
      ? Response.json({ token: "test-token" })
      : new Response("<html>Internal proxy detail</html>", { status: 502 })));
    render(<RepositoryPathPicker value="/mnt/work" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load folders from the server");
    expect(alert).not.toHaveTextContent("Internal proxy detail");
  });

  it("shows a readable timeout rather than an API envelope", async () => {
    respond({ error: "Folder lookup timed out; try another location" }, 503);
    render(<RepositoryPathPicker value="/mnt/work" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Folder lookup timed out; try another location");
    expect(alert).not.toHaveTextContent("API error");
  });
});
