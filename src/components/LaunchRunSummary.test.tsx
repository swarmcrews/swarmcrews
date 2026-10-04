import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LaunchRunSummary } from "./LaunchRunSummary.tsx";

const policy = { filesystemScope: "unrestricted", fullHostScope: "leader-and-minions", approvalPolicy: "never" } as const;
describe("LaunchRunSummary", () => {
  it("names the full requested boundary without claiming prelaunch enforcement", () => {
    render(<LaunchRunSummary model="Long model label" changeMode="worktree" policy={policy} orchestration="Graph — review before start" skills={2} />);
    const summary = screen.getByRole("region", { name: "Launch summary" });
    expect(summary).toHaveTextContent("Full Host - Leader + Minions");
    expect(summary).toHaveTextContent("Never ask");
    expect(summary).toHaveTextContent("Resolved when the session starts");
    expect(summary).toHaveTextContent("Graph — review before start");
    expect(summary).toHaveTextContent("2 skills");
  });
  it("distinguishes an old resolved request from the changed draft", () => {
    render(<LaunchRunSummary model="Opus" changeMode="live" policy={policy} orchestration="Graph — auto-start safe work" skills={0}
      effective={{ requested: { filesystemScope: "read-only", approvalPolicy: "always" }, effective: { filesystemScope: "unmanaged", approvalPolicy: "unmanaged" }, unsupported: ["filesystemScope", "approvalPolicy"] }} />);
    const summary = within(screen.getByRole("region", { name: "Launch summary" }));
    expect(summary.getByText(/Last resolved request/)).toHaveTextContent("Read only · Always ask");
    expect(summary.getByText(/Changed request is not yet resolved/)).toHaveTextContent("unmanaged");
  });
});
