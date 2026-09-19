import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileDocumentPreview } from "./FileDocumentPreview.tsx";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FileDocumentPreview", () => {
  it("uses native heading levels and deterministic, collision-safe outline targets", () => {
    const { container } = render(<FileDocumentPreview content={"# Overview\n\n## Overview\n\n```md\n# Not an outline heading\n```"} />);

    const headings = container.querySelectorAll("article h1, article h2");
    expect(headings).toHaveLength(2);
    expect(headings[0]).toHaveAttribute("id", "file-document-heading-overview-0");
    expect(headings[1]).toHaveAttribute("id", "file-document-heading-overview-12");
    expect(screen.queryByRole("button", { name: "Not an outline heading" })).toBeNull();
  });

  it("moves focus to outline destinations with mouse and keyboard navigation", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    render(<FileDocumentPreview content={"# Start\n\n## Next"} />);

    const next = screen.getAllByRole("button", { name: "Next" })[0]!;
    expect(screen.getAllByRole("button", { name: "Start" })[0]).toHaveAttribute("aria-current", "location");
    fireEvent.keyDown(next, { key: "Enter" });
    expect(document.activeElement).toBe(document.getElementById("file-document-heading-next-9"));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("respects reduced motion during outline navigation", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    render(<FileDocumentPreview content={"# Start\n\n## Next"} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Next" })[0]!);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("keeps raw HTML inert while rendering the reader", () => {
    const { container } = render(<FileDocumentPreview content={"# Safe\n\n<img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});
