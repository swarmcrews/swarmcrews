import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionForm } from "./mcp-connections/ConnectionForm.tsx";
import { ConnectionsPanel } from "./mcp-connections/ConnectionsPanel.tsx";
import * as api from "./api.ts";
vi.mock("./api.ts", () => ({ listProjectMcpServers: vi.fn(), saveProjectMcpServer: vi.fn(), deleteProjectMcpServer: vi.fn(), testProjectConnection: vi.fn(), authorizeProjectConnection: vi.fn(), disconnectProjectConnection: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.listProjectMcpServers).mockResolvedValue({ entries: [], invalid: [] }); });
describe("Connections setup", () => {
  it("imports a Codex command and saves the server process, not the installer", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionForm existingIds={[]} busy={false} onSave={save} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Have an install/), { target: { value: 'codex mcp add files -- node server.mjs "a b"' } });
    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & test connection" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ command: "node", args: ["server.mjs", "a b"], id: "files" })));
  });
  it("editing a display name preserves argument boundaries and empty arguments", async () => {
    const save = vi.fn().mockResolvedValue(undefined); const args = ["--directory", "/tmp/My Project", "", 'a"b', "C:\\tools"];
    render(<ConnectionForm entry={{ id: "files", name: "Files", transport: "stdio", command: "node", args }} existingIds={["files"]} busy={false} onSave={save} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & test connection" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed", args })));
  });
  it("imports and edits named credentials while preserving multiline values", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionForm existingIds={[]} busy={false} onSave={save} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Have an install/), { target: { value: JSON.stringify({ mcp: { files: { type: "local", command: ["node", "server.mjs"], environment: { TOKEN: "line one\nline two" } } } }) } });
    fireEvent.click(screen.getByRole("button", { name: "Import configuration" }));
    expect(screen.getByLabelText("Variable name 1")).toHaveValue("TOKEN");
    fireEvent.click(screen.getByRole("button", { name: "Add argument" }));
    fireEvent.change(screen.getByLabelText("Argument 2"), { target: { value: "a folder with spaces" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & test connection" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ args: ["server.mjs", "a folder with spaces"], env: { TOKEN: "line one\nline two" } })));
  });
  it("requires unique credential names instead of overwriting values", async () => {
    const save = vi.fn();
    render(<ConnectionForm entry={{ id: "docs", name: "Docs", transport: "http", url: "https://example.com/mcp", headers: { Authorization: "masked" } }} existingIds={["docs"]} busy={false} onSave={save} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    fireEvent.change(screen.getByLabelText("Header name 2"), { target: { value: "Authorization" } });
    expect(screen.getByLabelText("Header name 2")).toBeInvalid();
    fireEvent.click(screen.getByRole("button", { name: "Save & test connection" }));
    expect(save).not.toHaveBeenCalled();
  });
  it("blocks duplicate names without overwriting a saved connection", async () => {
    const save = vi.fn(); render(<ConnectionForm existingIds={["example-com"]} busy={false} onSave={save} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://example.com/mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists"); expect(save).not.toHaveBeenCalled();
  });
  it("distinguishes a load failure from an empty catalog and supports retry", async () => {
    vi.mocked(api.listProjectMcpServers).mockRejectedValueOnce(new Error("Storage unavailable"));
    render(<ConnectionsPanel projectId="project" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
    expect(screen.queryByText("Bring your tools into the conversation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Bring your tools into the conversation")).toBeInTheDocument();
  });
  it("does not report zero tools when only the connection handshake was verified", async () => {
    vi.mocked(api.listProjectMcpServers).mockResolvedValue({ entries: [{ id: "docs", name: "Docs", transport: "http", url: "https://example.com/mcp" }], invalid: [], statuses: { docs: { state: "ready", checkedAt: 1 } } });
    render(<ConnectionsPanel projectId="project" />);
    const card = await screen.findByRole("article", { name: "Docs" });
    expect(within(card).getByText("Verified", { exact: true })).toBeInTheDocument();
    expect(within(card).queryByText(/0 tools available/)).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Sign in/ })).not.toBeInTheDocument();
  });
  it("shows authentication as the next action when a saved connection fails its test", async () => {
    vi.mocked(api.listProjectMcpServers).mockResolvedValue({ entries: [{ id: "docs", name: "Docs", transport: "http", url: "https://example.com/mcp" }], invalid: [] });
    vi.mocked(api.testProjectConnection).mockResolvedValue({ status: { state: "auth_required", message: "Sign in to continue" } });
    render(<ConnectionsPanel projectId="project" />);
    const card = await screen.findByRole("article", { name: "Docs" });
    fireEvent.click(within(card).getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Sign-in required")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /Sign in/ })).toBeEnabled();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });
});
