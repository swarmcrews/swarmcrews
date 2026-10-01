import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getProjectSettings,
  restartServer,
  updateProjectSettings,
} from "../api.ts";
import { HarnessListProvider } from "../use-harness-list.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";

vi.mock("../api.ts", () => ({
  getProjectSettings: vi.fn(),
  restartServer: vi.fn(),
  updateProjectSettings: vi.fn(),
}));

afterEach(() => {
  vi.mocked(getProjectSettings).mockReset();
  vi.mocked(updateProjectSettings).mockReset();
  vi.mocked(restartServer).mockReset();
  vi.restoreAllMocks();
});

describe("SettingsScreen", () => {
  it("keeps Minion routing fixed by default", async () => {
    vi.mocked(getProjectSettings).mockResolvedValue({
      defaultMinionModel: "claude-sonnet-5",
    });
    vi.mocked(updateProjectSettings).mockResolvedValue(undefined);

    render(
      <HarnessListProvider send={vi.fn()} subscribe={vi.fn()} connected={true}>
        <SettingsScreen project={{ id: "proj", name: "Project", path: "/work/app" }} />
      </HarnessListProvider>,
    );

    const toggle = await screen.findByRole("checkbox", { name: /adaptive tier routing/i });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("tablist", { name: /minion assignment tiers/i })).toBeNull();
    expect(screen.getByText(/one model is used unless a task specifies/i)).toBeInTheDocument();
  });

  it("uses tabs to edit adaptive Minion tier models", async () => {
    vi.mocked(getProjectSettings).mockResolvedValue({
      adaptiveMinionModelRouting: true,
      defaultMinionHarness: "claude",
      defaultMinionModel: "claude-sonnet-5",
      mechanicalMinionModel: "claude-fable-5",
      reasoningMinionModel: "claude-opus-4-8",
    });
    vi.mocked(updateProjectSettings).mockResolvedValue(undefined);

    render(
      <HarnessListProvider send={vi.fn()} subscribe={vi.fn()} connected={true}>
        <SettingsScreen project={{ id: "proj", name: "Project", path: "/work/app" }} />
      </HarnessListProvider>,
    );

    const tabs = await screen.findByRole("tablist", { name: /minion assignment tiers/i });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Mechanical" }));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "claude::claude-opus-4-8" },
    });

    expect(updateProjectSettings).toHaveBeenCalledWith("proj", expect.objectContaining({
      adaptiveMinionModelRouting: true,
      mechanicalMinionModel: "claude-opus-4-8",
      defaultMinionModel: "claude-sonnet-5",
      reasoningMinionModel: "claude-opus-4-8",
    }));
  });

  it("persists the beta role-system opt-in", async () => {
    vi.mocked(getProjectSettings).mockResolvedValue({ roleSystemBeta: false });
    vi.mocked(updateProjectSettings).mockResolvedValue(undefined);

    render(
      <HarnessListProvider send={vi.fn()} subscribe={vi.fn()} connected={true}>
        <SettingsScreen
          project={{ id: "proj", name: "Project", path: "/work/app" }}
        />
      </HarnessListProvider>,
    );

    const roleSystem = await screen.findByText(/Role System/, { selector: "span" });
    fireEvent.click(roleSystem.closest("summary")!);
    const toggle = screen.getByRole("checkbox", {
      name: /adaptive expert roles/i,
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    expect(updateProjectSettings).toHaveBeenCalledWith("proj", {
      roleSystemBeta: true,
    });
  });

  it("groups defaults separately from collapsed administration disclosures", async () => {
    vi.mocked(getProjectSettings).mockResolvedValue({});
    vi.mocked(updateProjectSettings).mockResolvedValue(undefined);

    render(
      <HarnessListProvider send={vi.fn()} subscribe={vi.fn()} connected={true}>
        <SettingsScreen project={{ id: "proj", name: "Project", path: "/work/app" }} />
      </HarnessListProvider>,
    );

    const defaultMinion = await screen.findByText("Default Minion", { selector: "span" });
    const defaultsGroup = screen.getByRole("region", { name: "Project defaults" });
    const administrationGroup = screen.getByRole("region", { name: "Connections & administration" });
    const roleSystem = screen.getByText(/Role System/, { selector: "span" });
    const connections = screen.getByText("Connections", { selector: "span" });
    const server = screen.getByText("Server", { selector: "span" });

    expect(defaultMinion.closest("details")).toHaveAttribute("open");
    expect(roleSystem.closest("details")).not.toHaveAttribute("open");
    expect(connections.closest("details")).not.toHaveAttribute("open");
    expect(server.closest("details")).not.toHaveAttribute("open");
    expect(defaultsGroup.compareDocumentPosition(administrationGroup) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("keeps advanced controls available through their disclosures", async () => {
    vi.mocked(getProjectSettings).mockResolvedValue({});
    vi.mocked(updateProjectSettings).mockResolvedValue(undefined);

    render(
      <HarnessListProvider send={vi.fn()} subscribe={vi.fn()} connected={true}>
        <SettingsScreen project={{ id: "proj", name: "Project", path: "/work/app" }} />
      </HarnessListProvider>,
    );

    const roleSystem = await screen.findByText(/Role System/, { selector: "span" });
    fireEvent.click(roleSystem.closest("summary")!);
    expect(screen.getByRole("checkbox", { name: /adaptive expert roles/i })).toBeVisible();

    const connections = screen.getByText("Connections", { selector: "span" });
    fireEvent.click(connections.closest("summary")!);
    expect(screen.getByRole("region", { name: "Connections" })).toBeVisible();

    const server = screen.getByText("Server", { selector: "span" });
    fireEvent.click(server.closest("summary")!);
    expect(screen.getByRole("button", { name: "Restart Server" })).toBeVisible();
  });

});
