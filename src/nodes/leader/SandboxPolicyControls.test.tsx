import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SandboxPolicyControls } from "./SandboxPolicyControls.tsx";

describe("SandboxPolicyControls", () => {
  it("distinguishes legacy Leader-only access from explicit Minion access", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SandboxPolicyControls onChange={onChange} policy={{
      filesystemScope: "unrestricted", approvalPolicy: "never",
    }} />);
    const select = screen.getByLabelText("Sandbox file access");
    expect(select).toHaveDisplayValue("Full Host - Leader Only");
    fireEvent.change(select, { target: { value: "unrestricted-with-minions" } });
    const extended = { filesystemScope: "unrestricted", approvalPolicy: "never",
      fullHostScope: "leader-and-minions" } as const;
    expect(onChange).toHaveBeenLastCalledWith(extended);
    rerender(<SandboxPolicyControls onChange={onChange} policy={extended} />);
    expect(select).toHaveDisplayValue("Full Host - Leader + Minions");
    fireEvent.change(screen.getByLabelText("Sandbox approval policy"), { target: { value: "on-failure" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...extended, approvalPolicy: "on-failure" });
    fireEvent.change(select, { target: { value: "workspace-write" } });
    expect(onChange).toHaveBeenLastCalledWith({ filesystemScope: "workspace-write", approvalPolicy: "never" });
    fireEvent.change(select, { target: { value: "unrestricted" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...extended, fullHostScope: "leader-only" });
  });

  it("keeps help operable when policy editing is locked for an active session", () => {
    render(<SandboxPolicyControls disabled onChange={vi.fn()} />);
    expect(screen.getByLabelText("Sandbox file access")).toBeDisabled();
    expect(screen.getByLabelText("Sandbox approval policy")).toBeDisabled();
    const help = screen.getByRole("button", { name: "About sandbox file access" });
    expect(help).toBeEnabled();
    fireEvent.click(help);
    expect(screen.getByRole("region", { name: "About sandbox file access" })).toBeVisible();
  });

  it("disables both full host options when the harness cannot enforce them", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} support={{ filesystem: ["workspace-write"], approval: true }} />);
    expect(screen.getByRole("option", { name: "Full Host - Leader Only" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Full Host - Leader + Minions" })).toBeDisabled();
  });
  it("edits filesystem and approval axes independently", () => {
    const onChange = vi.fn();
    render(<SandboxPolicyControls onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Sandbox file access"), { target: { value: "read-only" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      filesystemScope: "read-only", approvalPolicy: "on-failure",
    }));
  });

  it("opens named help with a button and dismisses with Escape or Close, restoring focus", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} />);
    const help = screen.getByRole("button", { name: "About sandbox file access" });
    help.focus();
    expect(help).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(help);
    expect(help).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "About sandbox file access" });
    expect(region).toHaveTextContent("Workspace write limits edits");
    fireEvent.keyDown(region, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "About sandbox file access" })).toBeNull();
    expect(help).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "About sandbox approval policy" }));
    expect(screen.getByRole("region", { name: "About sandbox approval policy" })).toHaveTextContent("guarded actions");
    fireEvent.click(screen.getByRole("button", { name: "Close sandbox approval policy help" }));
    expect(screen.getByRole("button", { name: "About sandbox approval policy" })).toHaveFocus();
  });

  it("discloses the full requested host scope outside the native control", () => {
    const { rerender } = render(<SandboxPolicyControls onChange={vi.fn()} policy={{
      filesystemScope: "unrestricted", approvalPolicy: "never", fullHostScope: "leader-and-minions",
    }} />);
    expect(screen.getByLabelText("Sandbox file access")).toHaveAccessibleDescription(
      "Requested: Full Host - Leader + Minions. Remove the process sandbox for the Leader and its Minions.",
    );
    expect(screen.getByLabelText("Sandbox approval policy")).toHaveAccessibleDescription(
      expect.stringContaining("rejects escalation instead of prompting"),
    );
    rerender(<SandboxPolicyControls onChange={vi.fn()} support={null} policy={{
      filesystemScope: "unrestricted", approvalPolicy: "never",
    }} />);
    expect(screen.getByText("Full Host - Leader Only.", { exact: false })).toBeVisible();
    expect(screen.getByText(/Minions keep their task sandbox/)).toBeVisible();
    expect(screen.getByText(/Effective policy is resolved when the session starts/)).toBeVisible();
  });

  it("does not imply an old effective resolution enforces a changed request", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} policy={{ filesystemScope: "unrestricted", approvalPolicy: "never" }} effective={{
      requested: { filesystemScope: "workspace-write", approvalPolicy: "on-request" },
      effective: { filesystemScope: "workspace-write", approvalPolicy: "on-request" }, unsupported: [],
    }} />);
    expect(screen.getByText(/Effective from last launch:/)).toBeVisible();
    expect(screen.getByText(/Changed request is not yet resolved/)).toBeVisible();
  });

  it("shows the server-resolved posture and unsupported guarantees", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} policy={{ filesystemScope: "workspace-write", approvalPolicy: "on-request" }} effective={{
      requested: { filesystemScope: "workspace-write", approvalPolicy: "on-request" },
      effective: { filesystemScope: "unmanaged", approvalPolicy: "unmanaged" },
      unsupported: ["filesystem:workspace-write", "approval"],
    }} />);
    expect(screen.getByText(/Effective: unmanaged/)).toHaveTextContent("unmanaged: filesystem:workspace-write, approval");
  });

  it("labels unsupported harness axes as unmanaged instead of editable", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} support={{
      filesystem: [], approval: false,
    }} />);

    expect(screen.getByLabelText("Sandbox file access")).toHaveTextContent("Unmanaged by harness");
    expect(screen.getByLabelText("Sandbox approval policy")).toHaveTextContent("Unmanaged by harness");
    expect(screen.getByText(/Enabled editing tools can change files/)).toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});
