import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthToken } from "../api.ts";
import { getNodeType } from "../node-registry.ts";
import type { CanvasNode } from "../types.ts";
import "./FileViewerNode.tsx";

function fixture() {
  const reads: { url: string; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => url === "/api/auth/token"
    ? Promise.resolve(new Response(JSON.stringify({ token: "fixture" })))
    : new Promise<Response>(resolve => reads.push({ url, resolve }))));
  const updates = vi.fn();
  const Render = getNodeType("file-viewer")!.render;
  function Host() {
    const [root, setRoot] = useState("/workspace/first");
    const [node, setNode] = useState<CanvasNode>({ id: "read-fixture", type: "file-viewer",
      position: { x: 0, y: 0 }, size: { width: 480, height: 420 },
      data: { filePath: "src/evidence.ts", collapsed: false } });
    return <><button onClick={() => setNode(previous => ({ ...previous,
      data: { filePath: "src/other.ts", collapsed: false } }))}>Change file</button>
      <button onClick={() => setRoot("/workspace/second")}>Change root</button>
      <Render node={node} projectPath={root} isSelected={false}
        onUpdateData={data => { updates(data); setNode(previous => ({ ...previous, data })); }} />
    </>;
  }
  render(<Host />);
  const release = async (index: number, ok: boolean, content = "restored evidence") => {
    await act(async () => reads[index]!.resolve(new Response(JSON.stringify(ok
      ? { content, size: content.length, truncated: false }
      : { error: "SIMULATED unavailable file" }), { status: ok ? 200 : 500 })));
  };
  return { reads, release, updates };
}
beforeEach(clearAuthToken);
afterEach(() => { vi.unstubAllGlobals(); clearAuthToken(); });

describe("File Viewer explicit recovery", () => {
  it("retries the same identity once while pending, keeps failure readable, and returns focus to recovered contents", async () => {
    const f = fixture(); await waitFor(() => expect(f.reads).toHaveLength(1));
    await f.release(0, false);
    const retry = screen.getByRole("button", { name: "Retry file" });
    retry.focus(); fireEvent.click(retry); fireEvent.click(retry);
    await waitFor(() => expect(f.reads).toHaveLength(2));
    expect(retry).toHaveAttribute("aria-disabled", "true"); expect(retry).toHaveFocus();
    expect(screen.getByText("SIMULATED unavailable file")).toBeVisible();
    expect(f.reads[1]!.url).toBe(f.reads[0]!.url);
    await f.release(1, true);
    const contents = screen.getByRole("region", { name: "File contents" });
    expect(contents).toHaveTextContent("restored evidence"); expect(contents).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Retry file" })).toBeNull();
    expect(f.updates).toHaveBeenLastCalledWith(expect.objectContaining({
      filePath: "src/evidence.ts", collapsed: false, loadedContent: "restored evidence" }));
  });
  it("retains failed retry for another attempt and does not refetch on collapse/expand", async () => {
    const f = fixture(); await waitFor(() => expect(f.reads).toHaveLength(1)); await f.release(0, false);
    fireEvent.click(screen.getByRole("button", { name: "Collapse file viewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand file viewer" }));
    expect(f.reads).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry file" }));
    await waitFor(() => expect(f.reads).toHaveLength(2)); await f.release(1, false);
    expect(screen.getByRole("button", { name: "Retry file" })).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(screen.getByRole("button", { name: "Retry file" }));
    await waitFor(() => expect(f.reads).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Collapse file viewer" }));
    await f.release(2, true);
    expect(screen.getByRole("button", { name: "Expand file viewer" })).toBeVisible();
    expect(f.updates).toHaveBeenLastCalledWith(expect.objectContaining({ collapsed: true,
      filePath: "src/evidence.ts", loadedContent: "restored evidence" }));
    expect(f.reads).toHaveLength(3);
  });
  it.each([["Change file", true], ["Change root", true], ["Change file", false], ["Change root", false]] as const)(
    "discards obsolete retry results after %s (success=%s)", async (name, oldOk) => {
    const f = fixture(); await waitFor(() => expect(f.reads).toHaveLength(1)); await f.release(0, false);
    fireEvent.click(screen.getByRole("button", { name: "Retry file" }));
    await waitFor(() => expect(f.reads).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(f.reads).toHaveLength(3));
    await f.release(2, true, "current identity"); await f.release(1, oldOk, "obsolete identity");
    expect(screen.getByRole("region", { name: "File contents" })).toHaveTextContent("current identity");
    expect(screen.queryByText("obsolete identity")).toBeNull();
    expect(screen.queryByText("SIMULATED unavailable file")).toBeNull();
    expect(screen.getByRole("region", { name: "File contents" })).toHaveAttribute("aria-busy", "false");
    expect(f.updates.mock.calls.flat().some(value => value.loadedContent === "obsolete identity")).toBe(false);
  });
});
