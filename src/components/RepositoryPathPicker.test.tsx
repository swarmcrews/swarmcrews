import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRepositoryPathSuggestions } from "../api.ts";
import { RepositoryPathPicker } from "./RepositoryPathPicker.tsx";

vi.mock("../api.ts", () => ({ getRepositoryPathSuggestions: vi.fn() }));

const windowsResult = {
  platform: "win32" as const,
  separator: "\\" as const,
  roots: [{ name: "C:", path: "C:\\" }],
  directory: "C:\\work",
  parent: "C:\\",
  breadcrumbs: [{ name: "work", path: "C:\\work" }],
  entries: [{ name: "demo", path: "C:\\work\\demo" }],
  truncated: false,
};

beforeEach(() => { vi.mocked(getRepositoryPathSuggestions).mockReset(); });

describe("RepositoryPathPicker", () => {
  it("retains returned Windows paths exactly and selects with the keyboard", async () => {
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue(windowsResult);
    const onChange = vi.fn();
    render(<RepositoryPathPicker value="C:\\work\\d" onChange={onChange} />);

    const input = screen.getByRole("combobox", { name: "Folders on the server" });
    fireEvent.focus(input);
    await waitFor(() => expect(screen.getByRole("option", { name: /demo/i })).toBeInTheDocument());
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("C:\\work\\demo");
  });

  it("browses roots and keeps manual input available after a failed request", async () => {
    vi.mocked(getRepositoryPathSuggestions).mockRejectedValue(new Error("offline"));
    const onChange = vi.fn();
    render(<RepositoryPathPicker value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "/new/folder" } });
    expect(onChange).toHaveBeenCalledWith("/new/folder");
  });

  it("dismisses suggestions with Escape", async () => {
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue(windowsResult);
    render(<RepositoryPathPicker value="C:\\work" onChange={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await screen.findByRole("listbox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ignores an older browse response after a newer request", async () => {
    let resolveFirst!: (value: typeof windowsResult) => void;
    let resolveSecond!: (value: typeof windowsResult) => void;
    vi.mocked(getRepositoryPathSuggestions)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    render(<RepositoryPathPicker value="C:\\work" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    await waitFor(() => expect(getRepositoryPathSuggestions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    await waitFor(() => expect(getRepositoryPathSuggestions).toHaveBeenCalledTimes(2));
    resolveSecond({ ...windowsResult, entries: [{ name: "new", path: "C:\\work\\new" }] });
    expect(await screen.findByRole("option", { name: /new/i })).toBeInTheDocument();
    resolveFirst(windowsResult);
    await waitFor(() => expect(screen.getByRole("option", { name: /new/i })).toBeInTheDocument());
  });

  it("navigates into Windows roots and folders before explicitly selecting", async () => {
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({ ...windowsResult, directory: null, entries: [] });
    const change = vi.fn();
    render(<RepositoryPathPicker value="" onChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    const root = await screen.findByRole("button", { name: "C:\\" });
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue(windowsResult);
    fireEvent.click(root);
    const entry = await screen.findByRole("option", { name: /demo/ });
    expect(change).not.toHaveBeenCalled();
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({ ...windowsResult, directory: "C:\\work\\demo", entries: [] });
    fireEvent.click(entry);
    fireEvent.click(await screen.findByRole("button", { name: "Use this folder" }));
    expect(change).toHaveBeenCalledWith("C:\\work\\demo");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("invalidates old requests during the typing debounce and after dismissal", async () => {
    let resolveOld!: (value: typeof windowsResult) => void;
    vi.mocked(getRepositoryPathSuggestions).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    render(<RepositoryPathPicker value="C:\\work" onChange={vi.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    await waitFor(() => expect(getRepositoryPathSuggestions).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(getRepositoryPathSuggestions).mock.calls[0]![1]!;
    fireEvent.change(input, { target: { value: "C:\\other" } });
    expect(signal.aborted).toBe(true);
    await act(async () => resolveOld(windowsResult));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it.each(["Enter", "Tab"])("%s selects autocomplete without submitting a form", async (key) => {
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue(windowsResult);
    const submit = vi.fn();
    const change = vi.fn();
    render(<form onSubmit={submit}><RepositoryPathPicker value="C:\\work\\d" onChange={change} onSubmit={submit} /><button>Open</button></form>);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    await screen.findByRole("option");
    fireEvent.keyDown(input, { key });
    expect(change).toHaveBeenCalledWith("C:\\work\\demo");
    expect(submit).not.toHaveBeenCalled();
  });

  it("can recover an invalid typed path by browsing configured locations", async () => {
    vi.mocked(getRepositoryPathSuggestions).mockRejectedValueOnce(new Error("Folder unavailable"));
    render(<RepositoryPathPicker value="C:\\missing\\new" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    await screen.findByRole("alert");
    vi.mocked(getRepositoryPathSuggestions).mockResolvedValue({ ...windowsResult, directory: null, entries: [] });
    fireEvent.click(screen.getByRole("button", { name: "Browse locations" }));
    expect(await screen.findByRole("button", { name: "C:\\" })).toBeInTheDocument();
    expect(getRepositoryPathSuggestions).toHaveBeenLastCalledWith({ path: "", mode: "browse" }, expect.any(AbortSignal));
  });
});
