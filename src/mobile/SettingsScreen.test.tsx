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

    const toggle = await screen.findByRole("checkbox", {
      name: /adaptive expert roles/i,
    });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    expect(updateProjectSettings).toHaveBeenCalledWith("proj", {
      roleSystemBeta: true,
    });
  });

  it("places Connections below core project settings", async () => {
    vi.mocked(getProjectSettings).mockResolvedValue({});
    vi.mocked(updateProjectSettings).mockResolvedValue(undefined);

    render(
      <HarnessListProvider send={vi.fn()} subscribe={vi.fn()} connected={true}>
        <SettingsScreen project={{ id: "proj", name: "Project", path: "/work/app" }} />
      </HarnessListProvider>,
    );

    const minion = await screen.findByRole("heading", { name: "Default Minion" });
    const roleSystem = screen.getByRole("heading", { name: /Role System/i });
    const connections = screen.getByRole("region", { name: "Connections" });
    const server = screen.getByRole("heading", { name: "Server" });

    expect(minion.compareDocumentPosition(roleSystem) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(roleSystem.compareDocumentPosition(connections) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(connections.compareDocumentPosition(server) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

});
