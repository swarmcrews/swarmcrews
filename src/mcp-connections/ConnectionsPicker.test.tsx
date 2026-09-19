import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionsPicker } from "./ConnectionsPicker.tsx";
import { ConnectionForm } from "./ConnectionForm.tsx";
import { SandboxPolicyControls } from "../nodes/leader/SandboxPolicyControls.tsx";
import { listProjectMcpServers } from "../api.ts";
vi.mock("../api.ts", () => ({ listProjectMcpServers: vi.fn() }));
const entries = [
  { id: "docs", name: "Docs", transport: "http" as const, url: "https://example.com/mcp", isDefault: true, selfServe: false },
  { id: "tools", name: "Tools", transport: "http" as const, url: "https://example.com/tools" },
];
beforeEach(() => { vi.clearAllMocks(); vi.mocked(listProjectMcpServers).mockResolvedValue({ entries, invalid: [] }); });
function Picker() {
  const [ids, setIds] = useState<string[]>();
  return <ConnectionsPicker projectId="project" connectionIds={ids} onChange={setIds} onPolicyChange={vi.fn()} />;
}
describe("MCP context controls", () => {
  it("selects defaults, shows explicit context separately from self-serve, and retains deselection after refresh", async () => {
    render(<Picker />);
    fireEvent.click(await screen.findByRole("button", { name: "Configure connections, 1 selected" }));
    expect(screen.getByRole("checkbox", { name: /Docs/ })).toBeChecked();
    expect(screen.getByText("Available for self-serve")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Docs/ }));
    expect(screen.getByText("Select to allow use · Default")).toBeInTheDocument();
    window.dispatchEvent(new CustomEvent("project-connections-changed", { detail: { projectId: "project" } }));
    await waitFor(() => expect(listProjectMcpServers).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("checkbox", { name: /Docs/ })).not.toBeChecked();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure connections" })).toHaveFocus();
  });
  it("saves independent default and self-serve switches", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionForm entry={entries[0]} existingIds={["docs"]} busy={false} onSave={save} onCancel={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Default" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Self-serve" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Default" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Self-serve" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & test connection" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ isDefault: false, selfServe: true })));
  });
  it("offers approval prompts without changing file access or silently changing policy", () => {
    const change = vi.fn();
    render(<SandboxPolicyControls mcpAvailable policy={{ filesystemScope: "read-only", approvalPolicy: "never" }} support={{ filesystem: ["read-only"], approval: true }} onChange={change} />);
    expect(screen.getByText(/Never ask can block MCP/)).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Allow MCP approval prompts" }));
    expect(change).toHaveBeenCalledWith({ filesystemScope: "read-only", approvalPolicy: "on-request" });
  });
  it("directs unmanaged harnesses to permission mode without offering an unsupported setting", () => {
    render(<SandboxPolicyControls mcpAvailable policy={{ filesystemScope: "read-only", approvalPolicy: "never" }} support={null} onChange={vi.fn()} />);
    expect(screen.getByText(/manages MCP permissions through its own permission mode/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow MCP approval prompts" })).not.toBeInTheDocument();
  });
});
