import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { getNodeType } from "../node-registry.ts";
import type { CanvasNode } from "../types.ts";
import "./FileViewerNode.tsx";

const text = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
function fixture(collapsed = false, delayed = false) {
  let resolveFile!: (response: Response) => void;
  const response = () => new Response(JSON.stringify({ content: text, size: text.length, truncated: false }));
  const file = delayed ? new Promise<Response>(resolve => { resolveFile = resolve; }) : Promise.resolve(response());
  const fetch = vi.fn((url: string) => url === "/api/auth/token"
    ? Promise.resolve(new Response(JSON.stringify({ token: "fixture" }))) : file);
  vi.stubGlobal("fetch", fetch);
  const updates = vi.fn(), resize = vi.fn(), pointer = vi.fn();
  const Render = getNodeType("file-viewer")!.render;
  function Host() {
    const [node, setNode] = useState<CanvasNode>({ id: "file-1", type: "file-viewer", position: { x: 0, y: 0 },
      size: { width: 480, height: 420 }, data: { filePath: "src/long file.ts", collapsed } });
    return <div onPointerDown={pointer}><Render node={node} projectPath="/workspace/project" isSelected={false}
      onUpdateData={value => { updates(value); setNode(previous => ({ ...previous, data: value })); }}
      onResize={size => { resize(size); setNode(previous => ({ ...previous, size })); }} /></div>;
  }
  const view = render(<Host />);
  return { ...view, fetch, updates, resize, pointer, release: () => resolveFile(response()),
    reads: () => fetch.mock.calls.filter(([url]) => url.includes("/file?")).map(([url]) => url) };
}
beforeEach(clearAuthToken);
afterEach(() => { vi.unstubAllGlobals(); clearAuthToken(); });

describe("File Viewer keyboard/state boundary", () => {
  it("names both native toggle states, restores focused control and preserves content/scroll/fetch identity", async () => {
    const f = fixture();
    await screen.findByText("line 29");
    const collapse = screen.getByRole("button", { name: "Collapse file viewer" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    const body = document.getElementById(collapse.getAttribute("aria-controls")!)!;
    body.scrollTop = 64; body.scrollLeft = 32;
    collapse.focus(); fireEvent.click(collapse);
    const expand = screen.getByRole("button", { name: "Expand file viewer" });
    expect(expand).toHaveAttribute("aria-expanded", "false"); expect(expand).toHaveFocus();
    expect(f.updates).toHaveBeenLastCalledWith(expect.objectContaining({ collapsed: true,
      expandedHeight: 420, filePath: "src/long file.ts", loadedContent: text }));
    fireEvent.click(expand);
    const restored = screen.getByRole("button", { name: "Collapse file viewer" });
    expect(restored).toHaveFocus(); expect(screen.getByText("line 29")).toBeVisible();
    const restoredBody = document.getElementById(restored.getAttribute("aria-controls")!)!;
    expect(restoredBody.scrollTop).toBe(64); expect(restoredBody.scrollLeft).toBe(32);
    expect(f.resize).toHaveBeenLastCalledWith({ width: 480, height: 420 });
    expect(f.reads()).toEqual(["/api/projects/L3dvcmtzcGFjZS9wcm9qZWN0/file?path=src%2Flong%20file.ts"]);
  });
  it("retains collapsed selection when an outstanding read supplies context", async () => {
    const f = fixture(false, true);
    await waitFor(() => expect(f.reads()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Collapse file viewer" }));
    await act(async () => f.release());
    expect(screen.getByRole("button", { name: "Expand file viewer" })).toBeVisible();
    expect(f.updates).toHaveBeenLastCalledWith(expect.objectContaining({ collapsed: true,
      filePath: "src/long file.ts", loadedContent: text }));
    expect(f.reads()).toHaveLength(1);
  });
  it("preserves collapsed header drag threshold and isolates the native button from drag", async () => {
    const f = fixture(true); await waitFor(() => expect(f.reads()).toHaveLength(1));
    const expand = screen.getByRole("button", { name: "Expand file viewer" });
    const header = expand.parentElement!;
    fireEvent(header, new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
    fireEvent(header, new MouseEvent("pointerup", { clientX: 20, clientY: 10, bubbles: true }));
    expect(screen.getByRole("button", { name: "Expand file viewer" })).toBeVisible();
    expect(f.pointer).toHaveBeenCalledTimes(1);
    fireEvent(expand, new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
    fireEvent.click(expand); expect(f.pointer).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Collapse file viewer" }));
    const row = screen.getByRole("button", { name: "Expand file viewer" }).parentElement!;
    fireEvent(row, new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
    fireEvent(row, new MouseEvent("pointerup", { clientX: 12, clientY: 11, bubbles: true }));
    expect(screen.getByRole("button", { name: "Collapse file viewer" })).toBeVisible();
  });
});
