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
    render(<SandboxPolicyControls onChange={vi.fn()} policy={{
      filesystemScope: "unrestricted", approvalPolicy: "never", fullHostScope: "leader-and-minions",
    }} />);
    expect(screen.getByLabelText("Sandbox file access")).toHaveAccessibleDescription(
      "Full Host - Leader + Minions. Remove the process sandbox for the Leader and its Minions.",
    );
    expect(screen.getByLabelText("Sandbox approval policy")).toHaveAccessibleDescription(
      expect.stringContaining("rejects escalation instead of prompting"),
    );
  });

  it("does not imply an old effective resolution enforces a changed request", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} policy={{ filesystemScope: "unrestricted", approvalPolicy: "never" }} effective={{
      requested: { filesystemScope: "workspace-write", approvalPolicy: "on-request" },
      effective: { filesystemScope: "workspace-write", approvalPolicy: "on-request" }, unsupported: [],
    }} />);
    const details = screen.getByText("Runtime policy · request changed").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Runtime policy · request changed"));
    expect(screen.getByText(/Effective from last launch:/)).toBeVisible();
    expect(screen.getByText(/Changed request is not yet resolved/)).toBeVisible();
  });

  it("shows the server-resolved posture and unsupported guarantees", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} policy={{ filesystemScope: "workspace-write", approvalPolicy: "on-request" }} effective={{
      requested: { filesystemScope: "workspace-write", approvalPolicy: "on-request" },
      effective: { filesystemScope: "unmanaged", approvalPolicy: "unmanaged" },
      unsupported: ["filesystem:workspace-write", "approval"],
    }} />);
    expect(screen.getByText("Runtime policy · not fully enforced")).toBeVisible();
    fireEvent.click(screen.getByText("Runtime policy · not fully enforced"));
    expect(screen.getByText(/Effective: unmanaged/)).toBeVisible();
    expect(screen.getByText(/Effective: unmanaged/)).toHaveTextContent("unmanaged: filesystem:workspace-write, approval");
  });

  it.each([null, { filesystem: [], approval: false }])("consolidates unsupported settings into one honest notice (%s)", (support) => {
    const onChange = vi.fn();
    render(<SandboxPolicyControls onChange={onChange} support={support} />);

    expect(screen.getByText("Not enforced by this harness")).toBeVisible();
    expect(screen.getByText("File access and approvals follow host permissions and harness configuration.")).toBeVisible();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryByText(/Requested/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Effective policy is resolved/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /About sandbox/ })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the supported axis editable for partial enforcement", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} support={{ filesystem: [], approval: true }} />);
    expect(screen.getByLabelText("Sandbox file access")).toHaveTextContent("Not enforced");
    expect(screen.getByLabelText("Sandbox approval policy")).toBeEnabled();
    expect(screen.queryByText(/Read and edit files in authorized project roots/)).not.toBeInTheDocument();
  });

  it("keeps routine explanations in help rather than repeating selected values", () => {
    render(<SandboxPolicyControls onChange={vi.fn()} />);
    expect(screen.queryByText(/Requested/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Git change mode/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About sandbox file access" }));
    expect(screen.getByText(/Git change mode/)).toBeVisible();
  });
});
