import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectSettings, getProjectSkills } from "../api.ts";
import { clearSkills } from "../skills/registry.ts";
import { LaunchScreen } from "./LaunchScreen.tsx";

vi.mock("../api.ts", () => ({
  listProjects: vi.fn().mockResolvedValue([]),
  getProjectSettings: vi.fn().mockResolvedValue({}),
  getProjectSkills: vi.fn().mockResolvedValue([]),
  saveProjectSkills: vi.fn().mockResolvedValue(undefined),
}));

const project = { id: "mobile-launch", path: "/workspace/mobile-launch", name: "Mobile launch" };

afterEach(() => {
  vi.mocked(getProjectSettings).mockReset().mockResolvedValue({});
  vi.mocked(getProjectSkills).mockReset().mockResolvedValue([]);
  vi.restoreAllMocks();
  clearSkills();
});

describe("mobile launch interaction", () => {
  it("allows drafting but waits for project defaults before accepting a launch", async () => {
    let resolveSettings!: (settings: Awaited<ReturnType<typeof getProjectSettings>>) => void;
    vi.mocked(getProjectSettings).mockReturnValueOnce(new Promise(resolve => { resolveSettings = resolve; }));
    const launch = vi.fn();
    render(<LaunchScreen lockedProject={project} canonicalLaunch={launch} onLaunched={vi.fn()} />);
    const prompt = screen.getByLabelText("Prompt");
    fireEvent.change(prompt, { target: { value: "Use the saved defaults" } });
    await waitFor(() => expect(getProjectSkills).toHaveBeenCalledWith(project.id));
    const submit = screen.getByRole("button", { name: "Launch leader" });
    expect(prompt).toBeEnabled();
    expect(submit).toBeDisabled();
    expect(screen.getByText("Loading project defaults before launch.")).toHaveAttribute("id", submit.getAttribute("aria-describedby"));
    expect(screen.getByLabelText("Worktree isolation")).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(launch).not.toHaveBeenCalled();

    await act(async () => resolveSettings({ defaultWorktreeIsolation: true,
      defaultSandboxPolicy: { filesystemScope: "read-only", approvalPolicy: "always" } }));
    expect(submit).toBeEnabled();
    expect(screen.getByLabelText("Worktree isolation")).toBeEnabled();
    fireEvent.click(submit);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Use the saved defaults", changeMode: "worktree",
      options: expect.objectContaining({ sandboxPolicy: { filesystemScope: "read-only", approvalPolicy: "always" } }),
    }), expect.any(Function), expect.any(Function));
  });

  it("waits for attachment reads even when the prompt is already launchable", async () => {
    let reader!: FileReader;
    vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (this: FileReader) { reader = this; });
    const launch = vi.fn();
    render(<LaunchScreen lockedProject={project} canonicalLaunch={launch} onLaunched={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Read the attached context" } });
    const submit = screen.getByRole("button", { name: "Launch leader" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Launch file attachments"), {
      target: { files: [new File(["Context"], "context.txt", { type: "text/plain" })] },
    });
    expect(submit).toBeDisabled();
    expect(screen.getByText("Preparing attachments before launch.")).toHaveAttribute("id", submit.getAttribute("aria-describedby"));
    fireEvent.submit(submit.closest("form")!);
    expect(launch).not.toHaveBeenCalled();

    await act(async () => {
      Object.defineProperty(reader, "result", { value: "Context" });
      reader.onload?.call(reader, new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Attached file: context.txt"),
    }), expect.any(Function), expect.any(Function));
  });

  it("keeps the action and retry error outside scrolling setup, and freezes submitted controls", async () => {
    let rejectLaunch!: (error: string) => void;
    const launch = vi.fn((_input, _started, onError) => { rejectLaunch = onError; });
    render(<LaunchScreen lockedProject={project} canonicalLaunch={launch} onLaunched={vi.fn()} />);
    const prompt = screen.getByLabelText("Prompt");
    fireEvent.change(prompt, { target: { value: "Keep this draft on failure" } });
    const submit = screen.getByRole("button", { name: "Launch leader" });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(prompt.closest(".mob-launch-scroll")).not.toBeNull();
    expect(submit.closest(".mob-launch-scroll")).toBeNull();
    fireEvent.click(submit);
    expect(prompt).toBeDisabled();
    expect(screen.getByLabelText("Model")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(launch).toHaveBeenCalledOnce();

    act(() => rejectLaunch("Connection lost. Try again."));
    const error = screen.getByRole("alert");
    expect(error.closest(".mob-launch-action")).toContainElement(submit);
    expect(error.closest(".mob-launch-scroll")).toBeNull();
    expect(prompt).toHaveValue("Keep this draft on failure");
    expect(prompt).toBeEnabled();
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
