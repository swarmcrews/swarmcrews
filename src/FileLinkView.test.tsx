import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FileLinkView from "./FileLinkView.tsx";
import { copyText } from "./components/CopyButton.tsx";

vi.mock("./api.ts", () => ({ getAuthToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("./components/CopyButton.tsx", () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

function openFile(path: string, content: string, query = "") {
  window.history.replaceState({}, "", `/file-view?project=workspace&path=${encodeURIComponent(path)}${query}`);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content, truncated: false }) });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function mockBlob(url: string, mime: string) {
  const create = vi.fn().mockReturnValue(url);
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["file"], { type: mime }) }));
  return { create, revoke };
}

describe("file link viewer", () => {
  it("loads safe source with authenticated encoded requests and truncation feedback", async () => {
    const fetch = openFile("/repo/a.ts", "first\n<script>evil()</script>", "&line=2");
    fetch.mockResolvedValue({ ok: true, json: async () => ({ content: "first\n<script>evil()</script>", truncated: true }) });
    render(<FileLinkView />);
    expect((await screen.findByText("<script>evil()</script>")).parentElement).toHaveAttribute("id", "L2");
    expect(document.querySelector("script")).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/projects/workspace/file?path=%2Frepo%2Fa.ts", expect.objectContaining({ headers: { Authorization: "Bearer test-token" } }));
    expect(screen.getByRole("status")).toHaveTextContent("512 KB");
  });

  it("switches modes, wraps source, and links and focuses a requested line", async () => {
    const fetch = openFile("README.md", "# Documentation\nsecond");
    render(<FileLinkView />);
    await screen.findByRole("heading", { name: "Documentation" });
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    fireEvent.change(screen.getByLabelText("Go to line"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(document.getElementById("L2")).toHaveClass("is-active");
    expect(document.getElementById("L2")).toHaveFocus();
    expect(new URLSearchParams(window.location.search).get("line")).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Wrap" }));
    expect(screen.getByRole("button", { name: "Wrap" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect(document.getElementById("L2")).toHaveClass("is-active");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("opens a Markdown line link in source mode", async () => {
    openFile("README.md", "# Documentation\nsecond", "&line=2");
    render(<FileLinkView />);
    await screen.findByText("second");
    expect(screen.getByRole("button", { name: "Source" })).toHaveAttribute("aria-pressed", "true");
    expect(document.getElementById("L2")).toHaveClass("is-active");
  });

  it("rejects malformed and out-of-range source line input", async () => {
    openFile("README.md", "# Documentation", "&line=-1");
    render(<FileLinkView />);
    await screen.findByRole("heading", { name: "Documentation" });
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    for (const value of ["0", "1.2", "999999", "9007199254740992"]) {
      fireEvent.change(screen.getByLabelText("Go to line"), { target: { value } });
      expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
      expect(screen.getByLabelText("Go to line")).toHaveAttribute("aria-invalid", "true");
    }
  });

  it("explains unavailable deep-linked lines", async () => {
    openFile("code.ts", "one line", "&line=99");
    render(<FileLinkView />);
    await screen.findByText("one line");
    expect(screen.getByRole("status")).toHaveTextContent("Line 99 is outside this preview");
  });

  it("copies exact source and reports clipboard failures", async () => {
    const source = "# Documentation\n  indented\n";
    openFile("README.md", source);
    render(<FileLinkView />);
    await screen.findByRole("heading", { name: "Documentation" });
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Source copied");
    expect(copyText).toHaveBeenCalledWith(source);
    vi.mocked(copyText).mockRejectedValueOnce(new Error("Clipboard denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copy failed"));
  });

  it("shows an empty state for empty Markdown", async () => {
    openFile("README.md", "");
    render(<FileLinkView />);
    expect(await screen.findByRole("heading", { name: "This file is empty" })).toBeInTheDocument();
    expect(screen.getByText("0 lines")).toBeInTheDocument();
  });

  it("retries file errors with a fresh request", async () => {
    const fetch = openFile("missing.ts", "recovered");
    fetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "File not found" }) });
    render(<FileLinkView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("File not found");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("recovered")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cleans image URLs and toggles sizing", async () => {
    openFile("picture.png", "");
    const { revoke } = mockBlob("blob:preview", "image/png");
    const { unmount } = render(<FileLinkView />);
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:preview"));
    fireEvent.click(screen.getByRole("button", { name: "Actual size" }));
    expect(screen.getByRole("button", { name: "Fit image" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("alert")).toHaveTextContent("This image could not be displayed");
    unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:preview");
  });

  it("does not create a blob URL for a response arriving after unmount", async () => {
    openFile("picture.png", "");
    const { create } = mockBlob("blob:late", "image/png");
    let resolveBlob!: (blob: Blob) => void;
    const blob = new Promise<Blob>(resolve => { resolveBlob = resolve; });
    const readBlob = vi.fn().mockReturnValue(blob);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: readBlob }));
    const { unmount } = render(<FileLinkView />);
    await waitFor(() => expect(readBlob).toHaveBeenCalled());
    unmount();
    resolveBlob(new Blob(["image"]));
    await blob;
    expect(create).not.toHaveBeenCalled();
  });

  it("provides a correctly typed PDF and open-preview fallback", async () => {
    openFile("report.pdf", "");
    const { create } = mockBlob("blob:pdf", "application/octet-stream");
    render(<FileLinkView />);
    expect(await screen.findByTitle("report.pdf PDF preview")).toHaveAttribute("src", "blob:pdf#page=1");
    expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", "blob:pdf");
    expect(create.mock.calls[0]?.[0]).toHaveProperty("type", "application/pdf");
  });
});
