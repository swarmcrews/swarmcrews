import { useEffect, useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeContent } from "./CanvasNodeContent.tsx";
import { MarkdownPreview } from "./components/MarkdownPreview.tsx";
import { MarkdownEditor } from "./components/MarkdownEditor.tsx";
import type { NodeRenderProps } from "./types.ts";

let callback: IntersectionObserverCallback;
const observe = vi.fn(), unobserve = vi.fn(), disconnect = vi.fn();
let constructions = 0;
let roots: (Element | Document | null | undefined)[] = [];
class Observer {
  constructor(cb: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    // CodeMirror also observes its editor; count only canvas-card observers.
    if (options.rootMargin === "400px") {
      callback = cb;
      constructions++;
      roots.push(options.root);
      this.observe = observe;
      this.unobserve = unobserve;
      this.disconnect = disconnect;
    }
  }
  observe = (_target: Element) => {};
  unobserve = (_target: Element) => {};
  disconnect = () => {};
}
function intersect(target: Element, isIntersecting = true) {
  act(() => callback([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
}
const started = vi.fn(), stopped = vi.fn();
function Runtime({ node }: NodeRenderProps) {
  useEffect(() => { started(); return stopped; }, []);
  const [draft, setDraft] = useState("");
  return <>
    <output>Runtime: {String(node.data)}</output>
    <MarkdownPreview content={`# ${String(node.data)}`} />
    <MarkdownEditor value={draft} onChange={setDraft} ariaLabel="Canvas document" />
    <input aria-label="Runtime draft" value={draft} onChange={e => setDraft(e.target.value)} />
  </>;
}
const initial = {
  renderer: Runtime, hiddenForDrag: false, isSelected: false, onUpdateData: vi.fn(),
  node: { id: "card", type: "markdown", data: "Initial content", position: { x: 5000, y: 5000 }, size: { width: 400, height: 300 } },
};
function Card({ props = initial, parked = false }: { props?: typeof initial; parked?: boolean }) {
  return <div className="canvas-node-card" style={{ display: parked ? "none" : undefined }}>
    <CanvasNodeContent {...props} />
  </div>;
}

beforeEach(() => { vi.stubGlobal("IntersectionObserver", Observer); constructions = 0; roots = []; vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("canvas presentation hydration", () => {
  it("defers offscreen previews and editors, not runtime effects or data", () => {
    const { container, rerender } = render(<Card />);
    const card = container.querySelector(".canvas-node-card")!;
    expect(started).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Runtime: Initial content")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).toBeNull();
    expect(observe).toHaveBeenCalledWith(card);
    intersect(card, false);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    rerender(<Card props={{ ...initial, node: { ...initial.node, data: "Recovered content" } }} />);
    expect(screen.getByText("Runtime: Recovered content")).toBeInTheDocument();
    intersect(card);
    expect(screen.getByRole("heading", { name: "Recovered content" })).toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(started).toHaveBeenCalledTimes(1);
    expect(stopped).not.toHaveBeenCalled();
  });

  it("keeps visited presentation and drafts mounted through panning and parking", () => {
    const { container, rerender } = render(<Card />);
    const card = container.querySelector(".canvas-node-card")!;
    intersect(card);
    const heading = screen.getByRole("heading");
    const editor = container.querySelector(".cm-editor");
    fireEvent.change(screen.getByLabelText("Runtime draft"), { target: { value: "Unsent text" } });
    intersect(card, false);
    rerender(<Card parked />);
    rerender(<Card />);
    expect(screen.getByRole("heading")).toBe(heading);
    expect(container.querySelector(".cm-editor")).toBe(editor);
    expect(screen.getByLabelText("Runtime draft")).toHaveValue("Unsent text");
    expect(unobserve).toHaveBeenCalledWith(card);
    expect(stopped).not.toHaveBeenCalled();
  });

  it("hydrates a selected card even before observer delivery", () => {
    const { rerender } = render(<Card parked />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    rerender(<Card props={{ ...initial, isSelected: true }} />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
    rerender(<Card />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it("shares a single observer across large canvases and releases removed cards", () => {
    const { container, unmount } = render(<>{Array.from({ length: 100 }, (_, i) =>
      <Card key={i} props={{ ...initial, node: { ...initial.node, id: `card-${i}` } }} />)}</>);
    expect(constructions).toBe(1);
    expect(observe).toHaveBeenCalledTimes(100);
    expect(container.querySelectorAll(".md-preview, .cm-editor")).toHaveLength(0);
    expect(started).toHaveBeenCalledTimes(100);
    unmount();
    expect(unobserve).toHaveBeenCalledTimes(100);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveBeenCalledTimes(100);
  });

  it("uses each canvas viewport as the root so its overflow clip does not cancel prewarming", () => {
    const { container, unmount } = render(<>
      <main className="canvas-root"><Card /><Card /></main>
      <main className="canvas-root"><Card /></main>
    </>);
    expect(constructions).toBe(2);
    expect(roots).toEqual([...container.querySelectorAll(".canvas-root")]);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it("does not defer non-canvas surfaces or browsers without IntersectionObserver", () => {
    const { unmount } = render(<CanvasNodeContent {...initial} />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(observe).not.toHaveBeenCalled();
    unmount();
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Card />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });
});
